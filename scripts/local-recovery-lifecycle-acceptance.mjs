import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {authorizeRunBudget} from '../core/cost/run-budget.ts';

// One combined lifecycle sequence, using the real Runner, batchReader,
// continuation code, migrated D1 and R2. Only the Workflow control/RPC boundary,
// clock, and vendor response are synthetic. No remote environment is contacted.
const reset='Durable Object reset because its code was updated.';
const pack=JSON.parse(await readFile('projects/validation/project.json','utf8'));
const entry=`
import {Runner} from './core/server/execution.ts';
import {Store} from './core/server/store.ts';
import {batchReader} from './core/server/batch-runner.ts';
import {inspectRunRecovery,recoverRun,dispatchRecovery} from './core/server/run-recovery.ts';
export default {async fetch(request,bindings){
 const data=await request.json(),{runId,mode,recoveryId,fingerprint}=data;
 const env={...bindings,JEV_API_KEY:{get:async()=> 'synthetic-local-secret'},OPENAI_API_KEY:{get:async()=> 'synthetic-local-secret'}};
 env.DOCUMENT_WORKFLOW={
  async get(id){await bindings.DB.prepare('INSERT INTO local_control_reads(id) VALUES(?)').bind(id).run();return{async status(){
   const row=await bindings.DB.prepare('SELECT status FROM local_workflow_control WHERE id=?').bind(id).first();
   if(!row)throw Error('Unknown synthetic execution');return row;
  }};},
  async create(options){
   await bindings.DB.prepare('INSERT INTO local_workflow_control(id,status,params_json) VALUES(?,?,?)').bind(options.id,'queued',JSON.stringify(options.params)).run();
   await bindings.DB.prepare('INSERT INTO local_control_creates(id) VALUES(?)').bind(options.id).run();
   // The first create succeeds remotely but its acknowledgement is lost.
   const count=await bindings.DB.prepare('SELECT COUNT(*) AS n FROM local_control_creates').first();
   if(count.n===1)throw Error(${JSON.stringify(reset)});
   return{id:options.id};
  }
 };
 const store=new Store(env),run=await store.run(runId),activePack=JSON.parse(run.pack_json);
 const options={acknowledged:true,assertReady:async()=>{}};
 if(mode==='inspect'||mode==='recover'||mode==='dispatch'){
  try{
   const result=mode==='inspect'?await inspectRunRecovery(store,runId,'owner'):mode==='recover'?await recoverRun(store,runId,'owner',options):await dispatchRecovery(store,runId,'owner',options);
   return Response.json({ok:true,...(mode==='inspect'?{remaining:result.documents.length}:result)});
  }catch(error){return Response.json({ok:false,code:error.code??null,message:error.message});}
 }
 if(mode==='halt'){
  await store.halt(runId,{code:'E_WORKFLOW_INTERRUPTED',message:'Synthetic interrupted continuation'},recoveryId);
  await bindings.DB.prepare("UPDATE local_workflow_control SET status='errored'").run();
  return Response.json({ok:true});
 }
 const entered=[],lost=[],waits=[];
 const targets=new Set(mode==='combined'?['confidence-http-1','confidence-circuit-outcome']:[]);
 const originalNow=Date.now;
 let logicalNow=1900000000000;
 Date.now=()=>logicalNow;
 const step={
  async do(name,config,callback){
   if(config.retries.limit!==0)throw Error('Unsafe automatic Workflow retry');
   const result=await callback();entered.push(name);
   if(targets.delete(name)){lost.push(name);throw Error('Synthetic completed-step acknowledgement lost');}
   return result;
  },
  async sleep(){throw Error('A wait bypassed the durable absolute-deadline helper');},
  async sleepUntil(name,until){
   waits.push({name,until});
   if(mode==='early'){logicalNow=Number(until)-1;throw Error(${JSON.stringify(reset)});}
   logicalNow=Number(until)+1;
   if(mode==='combined'){
    // Stand in for another Batch coordinator recording this document's result.
    // The result itself is synthetic; only the actual follower wait loop is tested.
    const key=await store.put(runId,fingerprint,'synthetic-reader-result',{value:{retained:true}});
    await bindings.DB.prepare('UPDATE documents SET reader_key=? WHERE run_id=? AND fingerprint=?').bind(key,runId,fingerprint).run();
    throw Error(${JSON.stringify(reset)});
   }
   throw Error('Unexpected new wait during checkpoint replay');
  }
 };
 try{
  const runner=new Runner(env,run,fingerprint,step,recoveryId);
  if(mode==='early'){
   await runner.wait('before-inference',30000);
   await runner.vendor({role:'confidence',endpoint:'https://api.typesafe.ai/v1/systemone',model:activePack.pins.confidence.id,modelPolicy:activePack.pins.confidence,body:'{}'},activePack,x=>x);
   return Response.json({ok:true,entered,lost,waits});
  }
  const confidence=await runner.vendor({role:'confidence',endpoint:'https://api.typesafe.ai/v1/systemone',model:activePack.pins.confidence.id,modelPolicy:activePack.pins.confidence,body:JSON.stringify({synthetic:true})},activePack,raw=>raw.value);
  const reader=await batchReader(runner,activePack,{role:'reader',endpoint:'https://api.openai.com/v1/responses',model:activePack.pins.reader.id,modelPolicy:activePack.pins.reader,body:JSON.stringify({synthetic:true})});
  const advanced=await runner.stage('healthy-next-phase',async()=>{
   await bindings.DB.prepare('INSERT INTO local_phase_counts(run_id,count) VALUES(?,1) ON CONFLICT(run_id) DO UPDATE SET count=count+1').bind(runId).run();
   return{confidence,reader,advanced:true};
  });
  return Response.json({ok:true,confidence,reader,advanced,value:await store.json(advanced),entered,lost,waits});
 }catch(error){return Response.json({ok:false,code:error.code??null,message:error.message,entered,lost,waits});}
 finally{Date.now=originalNow;}
}};`;
const compiled=await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'local-recovery-lifecycle-entry.ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
let checks=0,outbound=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const body=JSON.stringify({model:pack.pins.confidence.id,usage:{input_tokens:100,output_tokens:0},value:true});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-22',d1Databases:['DB'],r2Buckets:['ARTIFACTS'],bindings:{MODEL_CALLS_ENABLED:'true'},outboundService:request=>{
 check(new URL(request.url).hostname,'api.typesafe.ai');outbound++;return new Response(body,{headers:{'content-type':'application/json','content-length':String(Buffer.byteLength(body))}});
}}));
try{
 const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('ARTIFACTS');
 for(const name of(await readdir('migrations')).filter(name=>name.endsWith('.sql')).sort())await db.exec(await readFile(path.join('migrations',name),'utf8'));
 await db.exec('CREATE TABLE local_phase_counts(run_id TEXT PRIMARY KEY,count INTEGER); CREATE TABLE local_circuit_writes(run_id TEXT); CREATE TRIGGER local_circuit_insert AFTER INSERT ON vendor_circuits BEGIN INSERT INTO local_circuit_writes VALUES(NEW.run_id); END; CREATE TRIGGER local_circuit_update AFTER UPDATE ON vendor_circuits BEGIN INSERT INTO local_circuit_writes VALUES(NEW.run_id); END; CREATE TABLE local_workflow_control(id TEXT PRIMARY KEY,status TEXT,params_json TEXT); CREATE TABLE local_control_reads(id TEXT); CREATE TABLE local_control_creates(id TEXT);');
 const at='2026-09-24T00:00:00.000Z',actor='owner',main='lifecycle-main',early='lifecycle-early',generation1='generation-one';
 const budget=authorizeRunBudget({mode:'unlimited',limits:{blended:null,openai:null,typesafe:null},unlimitedAcknowledged:true},actor,at);
 const fingerprint=index=>(index+1).toString(16).padStart(64,'0');
 for(const [id,count] of [[main,114],[early,1]]){
  await db.prepare('INSERT INTO quotes(id,actor,created_at,mode,type_version,pack_hash,request_json,estimate_json) VALUES(?,?,?,?,?,?,?,?)').bind(id,actor,at,'batch','local-types','local-pack','{}','{}').run();
  await db.prepare('INSERT INTO runs(id,actor,status,created_at,mode,expected_count,threshold,threshold_justification,type_version,pack_json,budget_json,quote_id,text_held) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,actor,'running',at,'batch',count,0.9,'initial_design_threshold','local-types',JSON.stringify(pack),JSON.stringify(budget),id,1).run();
  for(let index=0;index<count;index++){
   const fp=fingerprint(index),key=id+'/input/'+fp,workflow=id===main?'reserved-one-'+index:'early-original';
   await bucket.put(key,JSON.stringify({fingerprint:fp,fullText:'Synthetic retained text'}));
   await db.prepare('INSERT INTO artifacts(key,run_id,fingerprint,kind,contains_text,state,created_at) VALUES(?,?,?,?,?,?,?)').bind(key,id,fp,'input',1,'complete',at).run();
   await db.prepare('INSERT INTO documents(run_id,fingerprint,tag,original_filename,status,input_key,input_hash,workflow_id) VALUES(?,?,?,?,?,?,?,?)').bind(id,fp,String(index).padStart(4,'0'),'synthetic.pptx','running',key,'unchanged-input',workflow).run();
  }
 }
 await db.prepare('INSERT INTO run_recoveries(id,run_id,generation,actor,created_at,original_halt_json) VALUES(?,?,?,?,?,?)').bind(generation1,main,1,actor,at,JSON.stringify({code:'E_WORKFLOW_INTERRUPTED'})).run();
 for(let index=0;index<114;index++){
  const state=index<67?'started':index===67?'dispatching':'pending';
  await db.prepare('INSERT INTO run_recovery_documents(recovery_id,fingerprint,old_workflow_id,new_workflow_id,state) VALUES(?,?,?,?,?)').bind(generation1,fingerprint(index),'original-'+index,'reserved-one-'+index,state).run();
  if(index<68)await db.prepare('INSERT INTO local_workflow_control(id,status,params_json) VALUES(?,?,?)').bind('reserved-one-'+index,'errored','{}').run();
 }
 const call=async(runId,mode,recoveryId,fp=fingerprint(0))=>{const response=await mf.dispatchFetch('http://localhost/lifecycle',{method:'POST',body:JSON.stringify({runId,mode,recoveryId,fingerprint:fp})});check(response.status,200);return response.json();};
 const first=await call(main,'combined',generation1);
 check(first.ok,true,JSON.stringify(first));check(first.lost,['confidence-http-1','confidence-circuit-outcome']);check(first.waits.length,1);check(first.value.advanced,true);check(outbound,1);
 check((await db.prepare('SELECT status FROM runs WHERE id=?').bind(main).first()).status,'running');
 check((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE run_id=? AND kind='workflow_wait_ack_recovered'").bind(main).first()).n,1);
 check((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE run_id=? AND kind='halted'").bind(main).first()).n,0);
 check((await db.prepare('SELECT COUNT(*) AS n FROM local_circuit_writes WHERE run_id=?').bind(main).first()).n,1);
 const paidRows=(await db.prepare('SELECT * FROM vendor_calls WHERE run_id=?').bind(main).all()).results;
 check(paidRows.length,1);check(paidRows[0].cost_nano,'4200');
 const rawEnvelope=await(await bucket.get(paidRows[0].raw_key)).json();check(rawEnvelope.raw,body);check(await(await bucket.get(rawEnvelope.responseKey)).text(),body);
 const deadlineRows=(await db.prepare("SELECT artifact_key FROM checkpoints WHERE run_id=? AND name LIKE '%-deadline'").bind(main).all()).results;
 check(deadlineRows.length,1);const deadline=await(await bucket.get(deadlineRows[0].artifact_key)).json();check(deadline.policy,'absolute-wait-v1');check(deadline.until,1900000030000);
 const earlyResult=await call(early,'early');check(earlyResult.ok,false);check(earlyResult.code,'E_WORKFLOW_INTERRUPTED');check(earlyResult.waits.length,1);check(outbound,1);
 check((await db.prepare('SELECT COUNT(*) AS n FROM vendor_calls WHERE run_id=?').bind(early).first()).n,0);
 const earlyDeadline=(await db.prepare('SELECT status FROM checkpoints WHERE run_id=?').bind(early).first());check(earlyDeadline.status,'complete');
 check((await call(main,'halt',generation1)).ok,true);
 const counts=(await db.prepare('SELECT state,COUNT(*) AS n FROM run_recovery_documents WHERE recovery_id=? GROUP BY state ORDER BY state').bind(generation1).all()).results;
 check(counts,[{state:'dispatching',n:1},{state:'pending',n:46},{state:'started',n:67}]);
 const frozen=await db.prepare('SELECT pack_json,budget_json,type_version,threshold FROM runs WHERE id=?').bind(main).first();
 const originalArtifacts=(await bucket.list()).objects.map(({key,etag})=>({key,etag}));
 const originalCheckpoints=(await db.prepare('SELECT * FROM checkpoints WHERE run_id=? ORDER BY name').bind(main).all()).results;
 const originalPlan=(await db.prepare('SELECT * FROM run_recovery_documents WHERE recovery_id=? ORDER BY fingerprint').bind(generation1).all()).results;
 const inspected=await call(main,'inspect');check(inspected.ok,true,JSON.stringify(inspected));check(inspected.remaining,114);
 const inspectedIds=(await db.prepare('SELECT id FROM local_control_reads').all()).results.map(row=>row.id);
 check(inspectedIds.length,68);check(inspectedIds.includes('reserved-one-67'),true);check(inspectedIds.some(id=>Number(id.split('-').at(-1))>=68),false,'Pending reserved identities must never be queried as created Workflows');
 const recovered=await call(main,'recover');check(recovered.ok,true,JSON.stringify(recovered));check(recovered.generation,2);check(recovered.started,50);check(recovered.pending,64);
 const second=await call(main,'dispatch');check(second.ok,true);check(second.started,50);check(second.pending,14);
 const third=await call(main,'dispatch');check(third.ok,true);check(third.started,14);check(third.pending,0);
 check((await db.prepare('SELECT COUNT(*) AS n FROM local_control_creates').first()).n,114);
 check((await db.prepare('SELECT COUNT(DISTINCT id) AS n FROM local_control_creates').first()).n,114,'Lost create ACK must not issue create again');
 check((await db.prepare('SELECT * FROM vendor_calls WHERE run_id=?').bind(main).all()).results,paidRows);
 check((await db.prepare('SELECT * FROM checkpoints WHERE run_id=? ORDER BY name').bind(main).all()).results,originalCheckpoints);
 check((await db.prepare('SELECT * FROM run_recovery_documents WHERE recovery_id=? ORDER BY fingerprint').bind(generation1).all()).results,originalPlan);
 check((await bucket.list()).objects.map(({key,etag})=>({key,etag})),originalArtifacts);
 check(await db.prepare('SELECT pack_json,budget_json,type_version,threshold FROM runs WHERE id=?').bind(main).first(),frozen);
 const generation2=(await db.prepare('SELECT id FROM run_recoveries WHERE run_id=? AND generation=2').bind(main).first()).id;
 // Execute the old deployed controller's unguarded SQL directly. The migration
 // must fence it even when that earlier JavaScript has not received this fix.
 await assert.rejects(()=>db.prepare("UPDATE run_recovery_documents SET state='dispatching' WHERE recovery_id=? AND fingerprint=? AND state='pending'").bind(generation1,fingerprint(68)).run());checks++;
 check((await db.prepare('SELECT state FROM run_recovery_documents WHERE recovery_id=? AND fingerprint=?').bind(generation1,fingerprint(68)).first()).state,'pending');
 check((await db.prepare('SELECT COUNT(*) AS n FROM local_control_creates').first()).n,114);
 const stale=await call(main,'healthy',generation1);check(stale.ok,false);check(stale.code,'E_WORKFLOW_SUPERSEDED');check(stale.entered,[]);check(outbound,1);
 const current=await call(main,'healthy',generation2);check(current.ok,true,JSON.stringify(current));check(current.advanced,first.advanced);check(current.waits,[]);check(outbound,1);
 const afterResume=(await bucket.list()).objects.map(({key,etag})=>({key,etag}));
 const again=await call(main,'healthy',generation2);check(again.ok,true);check(again.advanced,first.advanced);check(again.waits,[]);check(outbound,1);
 check((await bucket.list()).objects.map(({key,etag})=>({key,etag})),afterResume);
 check((await db.prepare('SELECT * FROM vendor_calls WHERE run_id=?').bind(main).all()).results,paidRows);
 check((await db.prepare('SELECT COUNT(*) AS n FROM local_circuit_writes WHERE run_id=?').bind(main).first()).n,1);
 check((await db.prepare('SELECT count FROM local_phase_counts WHERE run_id=?').bind(main).first()).count,1);
 check((await db.prepare('SELECT COUNT(*) AS n FROM vendor_calls WHERE run_id=? AND cost_nano IS NULL').bind(main).first()).n,0);
 check((await db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE run_id=? AND status!='complete'").bind(main).first()).n,0);
 check((await db.prepare('SELECT status FROM runs WHERE id=?').bind(main).first()).status,'running');
 const evidence={at:new Date().toISOString(),checks,syntheticVendorRequests:outbound,realVendorRequests:0,remoteMutations:0,runtime:'Actual Runner, transport, Batch follower and continuation logic in local workerd with migrated D1/R2; injected Workflow RPC/control and test clock',scope:['Combined completed HTTP/circuit ACK loss plus elapsed Batch wait reset advances the same document','Before-deadline reset blocks before inference','114-document 67 started / 1 dispatching / 46 never-created pending generation inspected safely','Lost create ACK reconciles its exact reserved identity without another create','Explicit second generation preserves records; stale Runner cannot claim work','Retained result replay does not duplicate paid calls, circuit writes or phase artifacts'],limitations:['Does not reproduce actual Cloudflare engine eviction/takeover','Batch reader result arrival is synthetic; no remote Batch submission or model-quality claim','Readiness is intentionally supplied by fixture; API/auth/UI acceptance is separate','Does not claim all 114 documents completed classification']};
 await mkdir('.local/qa',{recursive:true});await writeFile('.local/qa/recovery-lifecycle-runtime-'+Date.now()+'.json',JSON.stringify(evidence,null,2));
 console.log('Combined recovery lifecycle local acceptance: '+checks+' assertions passed; '+outbound+' synthetic vendor request; zero real vendor requests.');
}finally{await mf.dispose();}
