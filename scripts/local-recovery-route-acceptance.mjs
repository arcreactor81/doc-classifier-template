import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {authorizeRunBudget} from '../core/cost/run-budget.ts';
import {READER_PROMPT_VERSION} from '../core/vendors/requests.ts';
const pack=JSON.parse(await readFile('projects/validation/project.json','utf8'));
const entry=`import {handleWithCloudflareIdentity} from './core/server/api.ts';import {Store} from './core/server/store.ts';
export default {async fetch(request,bindings){
 const env={...bindings,JEV_API_KEY:{get:async()=> 'local-secret'},OPENAI_API_KEY:{get:async()=> 'local-secret'},DOCUMENT_WORKFLOW:{
  async get(id){return{async status(){const row=await bindings.DB.prepare('SELECT status FROM local_workflow_control WHERE id=?').bind(id).first();if(!row)throw Error('Unknown synthetic execution');return row;}};},
  async create(options){await bindings.DB.prepare('INSERT INTO local_workflow_control(id,status,params_json) VALUES(?,?,?)').bind(options.id,'queued',JSON.stringify(options.params)).run();return{id:options.id};}
 }};
 if(new URL(request.url).pathname==='/local-halt'){const data=await request.json();await new Store(env).halt(data.id,data.cause,data.recoveryId);return Response.json({ok:true});}
 return handleWithCloudflareIdentity(request,env,request.headers.get('X-Test-Actor')??'owner');
}};`;
const compiled=await build({stdin:{contents:entry,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',alias:{'project-pack':path.resolve('projects/validation/project.json')}});
let checks=0,outbound=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-22',d1Databases:['DB'],r2Buckets:['ARTIFACTS'],bindings:{MODEL_CALLS_ENABLED:'true',DEFINITION_MODE:'runtime',DEFINITION_EDITORS:'["owner"]'},outboundService:()=>{outbound++;throw Error('External requests forbidden');}}));
try{
 const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('ARTIFACTS');for(const name of(await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(path.join('migrations',name),'utf8'));
 await db.exec('CREATE TABLE local_workflow_control(id TEXT PRIMARY KEY,status TEXT,params_json TEXT)');
 const at='2026-09-24T00:00:00.000Z',actor='owner';
 const originalHalt={code:'E_INTERNAL',message:'Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.'};
 const budget=authorizeRunBudget({mode:'unlimited',limits:{blended:null,openai:null,typesafe:null},unlimitedAcknowledged:true},actor,at);
 for(const id of ['route-main','route-prompt']){
  await db.prepare('INSERT INTO quotes(id,actor,created_at,mode,type_version,pack_hash,request_json,estimate_json) VALUES(?,?,?,?,?,?,?,?)').bind(id,actor,at,'interactive','original-types','pack','{}',JSON.stringify({readerPromptVersion:id==='route-prompt'?'old-prompt':READER_PROMPT_VERSION})).run();
  await db.prepare('INSERT INTO runs(id,actor,status,created_at,mode,expected_count,threshold,threshold_justification,type_version,pack_json,budget_json,quote_id,text_held,halt_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,actor,'halted',at,'interactive',4,0.9,'original','original-types',JSON.stringify(pack),JSON.stringify(budget),id,1,JSON.stringify(originalHalt)).run();
  for(let index=0;index<4;index++){
   const fingerprint=String(index+1).repeat(64),key=id+'/input/'+index;
   await bucket.put(key,JSON.stringify({fingerprint,fullText:'Local synthetic input'}));
   await db.prepare('INSERT INTO artifacts(key,run_id,fingerprint,kind,contains_text,state,created_at) VALUES(?,?,?,?,?,?,?)').bind(key,id,fingerprint,'input',1,'complete',at).run();
   await db.prepare('INSERT INTO documents(run_id,fingerprint,tag,original_filename,status,input_key,input_hash,workflow_id,decision_json) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,fingerprint,id+'-'+index,'synthetic.pptx',index===0?'complete':'running',key,'original-hash',id+'-old-'+index,index===0?JSON.stringify({rule:'R1'}):null).run();
   await db.prepare('INSERT INTO local_workflow_control VALUES(?,?,?)').bind(id+'-old-'+index,index===0?'complete':'errored','{}').run();
  }
  const fp='2'.repeat(64),key=id+'/'+fp+'/raw/synthetic.json';await bucket.put(key,'{"original":"retained"}');
  await db.prepare('INSERT INTO artifacts(key,run_id,fingerprint,kind,state,created_at) VALUES(?,?,?,?,?,?)').bind(key,id,fp,'raw_response','complete',at).run();
  await db.prepare('INSERT INTO vendor_calls(attempt_id,run_id,fingerprint,role,model_requested,status,latency_ms,cost_nano,raw_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id+'-'+fp+'-confidence-1',id,fp,'confidence',pack.pins.confidence.id,200,1,'4200',key,at).run();
  await db.prepare('INSERT INTO checkpoints(run_id,fingerprint,name,status,artifact_key,started_at) VALUES(?,?,?,?,?,?)').bind(id,fp,'confidence-http-1','complete',key,at).run();
  await db.prepare('INSERT INTO events(id,run_id,created_at,stage,kind,details_json) VALUES(?,?,?,?,?,?)').bind(id+'-original-halt',id,at,'run','halted',JSON.stringify(originalHalt)).run();
 }
 const call=async(route,body,actor='owner')=>{const r=await mf.dispatchFetch('http://localhost/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','Origin':'http://localhost','X-Test-Actor':actor},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json()};};
 check((await call('runs/route-main/recovery',undefined,'other')).status,403);
 check((await call('runs/route-main/recover',{acknowledged:true},'other')).status,403);
 check((await call('runs/route-main/recover',{})).status,400);
 check((await call('runs/route-main/recover',{acknowledged:false})).status,400);
 await db.prepare('UPDATE controls SET kill=1').run();check((await call('runs/route-main/recovery')).body.error.code,'E_KILL_SWITCH');check((await call('runs/route-main/recover',{acknowledged:true})).body.error.code,'E_KILL_SWITCH');await db.prepare('UPDATE controls SET kill=0').run();
 check((await call('runs/route-prompt/recover',{acknowledged:true})).body.error.code,'E_RECOVERY_REQUEST_POLICY');
 check((await db.prepare('SELECT COUNT(*) AS n FROM run_recoveries').first()).n,0);
 check((await db.prepare("SELECT COUNT(*) AS n FROM local_workflow_control WHERE id NOT LIKE '%-old-%'").first()).n,0);
 const draft=await call('definitions/drafts',{baseRevisionId:null,typeFile:{...structuredClone(pack.typeFile),types:[{...pack.typeFile.types[0],what:pack.typeFile.types[0].what+' This active definition differs from the frozen run.'}]},displayNames:{}});check(draft.status,201);
 check((await call('definitions/'+draft.body.id+'/activate',{inheritThreshold:false})).status,200);
 const frozen=(await db.prepare('SELECT pack_json,budget_json,type_version,threshold FROM runs WHERE id=?').bind('route-main').first());
 const originalRows={checkpoints:(await db.prepare('SELECT * FROM checkpoints').all()).results,calls:(await db.prepare('SELECT * FROM vendor_calls').all()).results,artifacts:(await db.prepare('SELECT * FROM artifacts').all()).results};
 const objectsBefore=(await bucket.list()).objects.map(row=>({key:row.key,etag:row.etag}));
 const eligible=await call('runs/route-main/recovery');check(eligible.status,200);check(eligible.body.eligible,true);check(eligible.body.remaining,3);
 const first=await call('runs/route-main/recover',{acknowledged:true});assert.equal(first.status,200,JSON.stringify(first));checks++;check(first.body.generation,1);check(first.body.started,3);check(first.body.pending,0);check(first.body.status,'running');
 const again=await call('runs/route-main/recover',{acknowledged:true});check(again.status,200);check(again.body.started,0);check(again.body.pending,0);
 check((await db.prepare('SELECT COUNT(*) AS n FROM run_recoveries').first()).n,1);check((await db.prepare("SELECT COUNT(*) AS n FROM local_workflow_control WHERE id NOT LIKE '%-old-%'").first()).n,3);
 check(await db.prepare('SELECT pack_json,budget_json,type_version,threshold FROM runs WHERE id=?').bind('route-main').first(),frozen);
 check((await db.prepare('SELECT * FROM checkpoints').all()).results,originalRows.checkpoints);check((await db.prepare('SELECT * FROM vendor_calls').all()).results,originalRows.calls);check((await db.prepare('SELECT * FROM artifacts').all()).results,originalRows.artifacts);check((await bucket.list()).objects.map(row=>({key:row.key,etag:row.etag})),objectsBefore);
 const detail=await call('runs/route-main');check(detail.status,200);check(detail.body.run.status,'running');check(detail.body.run.recovery.generation,1);check(detail.body.run.recovery.pending,0);check(detail.body.run.completed,1);
 const plan=await db.prepare('SELECT id FROM run_recoveries WHERE run_id=?').bind('route-main').first();
 await mf.dispatchFetch('http://localhost/local-halt',{method:'POST',body:JSON.stringify({id:'route-main',recoveryId:plan.id,cause:{code:'E_KILL_SWITCH',message:'New epoch stop'}})});
 const halted=await call('runs/route-main');check(halted.body.run.stopReason.code,'E_KILL_SWITCH');check(halted.body.run.stopReason.headline,'New epoch stop');
 check(JSON.parse((await db.prepare('SELECT original_halt_json FROM run_recoveries WHERE id=?').bind(plan.id).first()).original_halt_json),originalHalt);check(outbound,0);
 const evidence={at:new Date().toISOString(),checks,outboundRequests:outbound,remoteMutations:0,runtime:'Real API handlers in local workerd and migrated D1/R2; synthetic Workflow control and identity',scope:['Owner and acknowledgement guards','Kill switch and frozen prompt guard','Frozen run preserved despite active category revision','Recovery route and repeated POST','Paid records and original artifacts unchanged','Recovery progress and new epoch stop reason'],limitations:['No live Access authentication or actual Workflow runtime; no model calls']};
 await mkdir('.local/qa',{recursive:true});await writeFile('.local/qa/recovery-route-runtime-'+Date.now()+'.json',JSON.stringify(evidence,null,2));console.log('Recovery route local acceptance: '+checks+' assertions passed; zero external calls.');
}finally{await mf.dispose();}
