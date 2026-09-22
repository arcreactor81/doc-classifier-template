import { uploadBatchInput,createBatch,pollBatch,ingestBatchResults,type BatchDependencies,type BatchSnapshot,type BatchInputEntry } from '../vendors/batch.ts';
import { decodeReader,type FrozenVendorRequest,type BatchResult } from '../vendors/requests.ts';
import type { ProjectPack } from '../config/project.ts';
import { actualUsageCost } from '../cost/cost.ts';
import { groupBatchArtifacts,type BatchArtifact } from './batch-groups.ts';
import { Runner,guard } from './execution.ts';
import { pricingFor } from './capabilities.ts';
import { Store,now } from './store.ts';
import { ServerFailure,failure } from './errors.ts';
import type { Upload } from './contracts.ts';
const io={maxMetadataBytes:1024*1024,maxResultLineBytes:8*1024*1024,streamChunkBytes:64*1024};
export async function batchReader(runner:Runner,pack:ProjectPack,request:FrozenVendorRequest):Promise<string>{
 const {store,env,run,fingerprint}=runner;
 const requestKey=await runner.stage('batch-request',async()=>request,true);
 await runner.stage('batch-register',async()=>{await env.DB.prepare('INSERT INTO batch_requests(run_id,fingerprint,request_key) VALUES(?,?,?)').bind(run.id,fingerprint,requestKey).run();return{requestKey};});
 for(let tick=0;;tick++){
  const statusKey=await runner.stage(`batch-wait-${tick}`,async()=>{
   const document=await store.document(run.id,fingerprint);if(document.reader_key)return{result:document.reader_key};if(document.failure_json)return{failure:JSON.parse(document.failure_json)};
   const waiting=await env.DB.prepare('SELECT COUNT(*) AS count FROM batch_requests WHERE run_id=?').bind(run.id).first<{count:number}>();
   const completed=await env.DB.prepare("SELECT COUNT(*) AS count FROM documents WHERE run_id=? AND status='complete' AND fingerprint NOT IN(SELECT fingerprint FROM batch_requests WHERE run_id=?)").bind(run.id,run.id).first<{count:number}>();
   if((waiting?.count??0)+(completed?.count??0)===run.expected_count)await env.DB.prepare('UPDATE runs SET batch_leader=? WHERE id=? AND batch_leader IS NULL').bind(fingerprint,run.id).run();
   const leader=await env.DB.prepare('SELECT batch_leader FROM runs WHERE id=?').bind(run.id).first<{batch_leader:string|null}>();return{leader:leader?.batch_leader===fingerprint};
  });
  const status=await store.json<{result?:string;failure?:{code:string;message:string};leader?:boolean}>(statusKey);
  if(status.result)return status.result;
  if(status.failure)throw new ServerFailure(status.failure.code,'document',status.failure.message);
  if(status.leader){await coordinate(runner,pack);continue;}
  await runner.step.sleep(`batch-wait-delay-${tick}`,'30 seconds');
 }
}
async function coordinateGroup(runner:Runner,pack:ProjectPack,group:BatchArtifact[],groupIndex:number):Promise<void>{
 const {store,env,run}=runner;

 let entries:BatchInputEntry[]=[];for(const row of group)entries.push({customId:row.fingerprint,request:await store.json<FrozenVendorRequest>(row.request_key)});
 for(let schemaAttempt=1;schemaAttempt<=2&&entries.length;schemaAttempt++){
  const batchKey=`${run.id}-g${groupIndex}-s${schemaAttempt}`,context={runId:run.id,batchKey,modelPolicy:pack.pins.reader};let requestIndex=0;
  const deps:BatchDependencies={
   fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10*60*1000)}),guard:()=>guard(env,store,run.id),readSecret:()=>env.OPENAI_API_KEY.get(),now:Date.now,
   attemptId:()=>`${batchKey}-${++requestIndex}-${crypto.randomUUID()}`,
   persistRaw:async record=>{await store.put(run.id,null,'batch_raw',record,false,`${run.id}/batch/raw/${record.attemptId}.json`);},
   logCall:async call=>{await env.DB.prepare('INSERT INTO vendor_calls(attempt_id,run_id,fingerprint,role,model_requested,model_returned,status,latency_ms,request_id,usage_json,cost_nano,raw_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(call.attemptId,run.id,runner.fingerprint,'batch_metadata',call.modelRequested,call.modelReturned,call.status,call.latencyMs,call.requestId,call.usage?JSON.stringify(call.usage):null,'0',`${run.id}/batch/raw/${call.attemptId}.json`,now()).run();},
   persistBatchState:async event=>{
    await store.put(run.id,null,'batch_state',event);
    if(event.stage==='input_uploaded')await env.DB.prepare("INSERT INTO batch_jobs(id,run_id,fingerprint,schema_attempt,state,input_file_id) VALUES(?,?,?,?,'input_uploaded',?)").bind(batchKey,run.id,group[0].fingerprint,schemaAttempt,event.fileId!).run();
    else if(event.snapshot)await env.DB.prepare('UPDATE batch_jobs SET state=?,remote_batch_id=? WHERE id=?').bind(event.snapshot.status,event.snapshot.id,batchKey).run();
   },
   persistChunk:async chunk=>{
    const key=`${run.id}/batch/chunks/${chunk.retrievalId}/${chunk.index}.bin`;
    await env.DB.prepare('INSERT INTO artifacts(key,run_id,kind,contains_text,created_at) VALUES(?,?,?,0,?)').bind(key,run.id,'batch_raw_chunk',now()).run();
    if(!await env.ARTIFACTS.put(key,chunk.bytes,{onlyIf:new Headers({'If-None-Match':'*'})}))throw new ServerFailure('E_ARTIFACT_EXISTS','blocker','A Batch response chunk already exists.');
    await env.DB.prepare("UPDATE artifacts SET state='complete' WHERE key=?").bind(key).run();
   },
   stageResult:batchResultStager(runner,pack,batchKey),
  };
  const inputKey=await runner.stage(`batch-${groupIndex}-${schemaAttempt}-upload`,()=>uploadBatchInput(entries,context,deps,io));
  const uploaded=await store.json<{fileId:string}>(inputKey);
  const createdKey=await runner.stage(`batch-${groupIndex}-${schemaAttempt}-create`,()=>createBatch(uploaded.fileId,context,deps,io));
  let snapshot=await store.json<BatchSnapshot>(createdKey);
  for(let poll=0;!['completed','failed','expired','cancelled'].includes(snapshot.status);poll++){
   const retryAfter=snapshot.retryAfter;
   let delay=30000;if(retryAfter){const value=/^\d+(?:\.\d+)?$/.test(retryAfter)?Number(retryAfter)*1000:Date.parse(retryAfter)-Date.now();if(!Number.isFinite(value))throw new ServerFailure('E_RETRY_AFTER','blocker','The Batch retry-after header is invalid.');delay=Math.max(delay,value);}
   await runner.step.sleep(`batch-${groupIndex}-${schemaAttempt}-poll-delay-${poll}`,delay);
   const key=await runner.stage(`batch-${groupIndex}-${schemaAttempt}-poll-${poll}`,()=>pollBatch(snapshot.id,context,deps,io));snapshot=await store.json<BatchSnapshot>(key);
  }
  const correlatedKey=await runner.stage(`batch-${groupIndex}-${schemaAttempt}-correlate`,()=>ingestBatchResults(snapshot,entries.map(entry=>entry.customId),context,deps,io));
  const correlated=await store.json<Awaited<ReturnType<typeof ingestBatchResults>>>(correlatedKey);
  const retry:BatchInputEntry[]=[];
  const validatedKey=await runner.stage(`batch-${groupIndex}-${schemaAttempt}-validate`,async()=>{
   for(const missing of correlated.failures)await env.DB.prepare('UPDATE documents SET failure_json=? WHERE run_id=? AND fingerprint=?').bind(JSON.stringify({code:missing.code,message:missing.detail}),run.id,missing.customId).run();
   for(const result of correlated.results){
    const staged=await store.json<{result:BatchResult}>(result.reference);const document=await store.document(run.id,result.customId);const uploaded=await store.json<Upload>(document.input_key!);
    try{
     const value=decodeReader(staged.result.response?.body,pack.pins.reader,pack.typeFile.types.map(type=>type.id),uploaded.fullText);
     const key=await store.put(run.id,result.customId,'reader-validated',{value,attemptIds:[`${batchKey}-${result.customId}`]});
     await env.DB.prepare('UPDATE documents SET reader_key=? WHERE run_id=? AND fingerprint=?').bind(key,run.id,result.customId).run();
    }catch(error){const issue=failure(error);if(issue.kind==='blocker')throw issue;
     if(issue.code==='E_READER_SCHEMA'&&schemaAttempt===1)retry.push(entries.find(entry=>entry.customId===result.customId)!);
     else await env.DB.prepare('UPDATE documents SET failure_json=? WHERE run_id=? AND fingerprint=?').bind(JSON.stringify({code:issue.code,message:issue.message}),run.id,result.customId).run();
    }
   }
   return{retryIds:retry.map(entry=>entry.customId)};
  });
  const validated=await store.json<{retryIds:string[]}>(validatedKey);
  entries=entries.filter(entry=>validated.retryIds.includes(entry.customId));
 }
}
async function coordinate(runner:Runner,pack:ProjectPack):Promise<void>{
 const {env,store,run}=runner;
 const rows=(await env.DB.prepare('SELECT fingerprint,request_key FROM batch_requests WHERE run_id=? ORDER BY fingerprint').bind(run.id).all<{fingerprint:string;request_key:string}>()).results;
 const metadata:BatchArtifact[]=[];
 // Bounded metadata work per checkpoint avoids placing all R2 HEAD requests in one step.
 for(let offset=0;offset<rows.length;offset+=50){
  const key=await runner.stage(`batch-artifact-heads-${offset}`,async()=>Promise.all(rows.slice(offset,offset+50).map(async row=>{
   const artifact=await env.ARTIFACTS.head(row.request_key);
   if(!artifact)throw new ServerFailure('E_ARTIFACT_MISSING','blocker','A recorded Batch request artifact is missing.');
   return{...row,bytes:artifact.size};
  })));
  metadata.push(...await store.json<BatchArtifact[]>(key));
 }
 const planKey=await runner.stage('batch-group-plan',async()=>groupBatchArtifacts(metadata));
 const groups=await store.json<BatchArtifact[][]>(planKey);
 for(const [groupIndex,group] of groups.entries())await coordinateGroup(runner,pack,group,groupIndex);
}

export function batchResultStager(runner:Runner,pack:ProjectPack,batchKey:string):BatchDependencies['stageResult'] {
 const {store,env,run}=runner;
 return async value=>{
    const key=await store.put(run.id,value.customId,'batch_result',value);
    const body=value.result.response?.body;
    const raw=body&&typeof body==='object'?body as Record<string,unknown>:null;
    const usage=raw?.usage&&typeof raw.usage==='object'?raw.usage as Record<string,unknown>:null;
    let cost:string|null=null,accountingFailure:unknown=null;
    const status=value.result.response?.status_code;
    const unsuccessful=value.result.response===null&&value.result.error!==null || typeof status==='number'&&(status<200||status>=300);
    const accountingDisposition=usage?'reported_usage':unsuccessful?'unsuccessful_no_usage':'unaccounted_success';
    if(usage||!unsuccessful){
     try{cost=actualUsageCost(usage,pricingFor(pack,'batch').reader,'disabled');}
     catch(error){accountingFailure=error;}
    }
    const accountingId=`${batchKey}-${value.customId}`;
    // Every received line has its own immutable artifact, but one submitted request is charged once.
    const recorded=await env.DB.prepare('INSERT OR IGNORE INTO vendor_calls(attempt_id,run_id,fingerprint,role,model_requested,model_returned,status,latency_ms,request_id,usage_json,cost_nano,raw_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(accountingId,run.id,value.customId,'reader',pack.pins.reader.id,typeof raw?.model==='string'?raw.model:null,value.result.response?.status_code??null,null,value.result.response?.request_id??null,usage?JSON.stringify(usage):null,cost,key,now()).run();
    await store.event(run.id,value.customId,'batch','result_staged',{key,source:value.source,accountingId,accountingDisposition,charged:recorded.meta.changes===1&&cost!==null});
    if(recorded.meta.changes===1&&accountingFailure)throw accountingFailure;
    return key;

 };
}
