import type { CheckpointStore } from './checkpoint.ts';
import { ServerFailure } from './errors.ts';
import { reconcileTextWrites } from './closure.ts';
import { cancelAndDeleteBatchInputs,type BatchCleanupRaw } from '../vendors/batch-closure.ts';
export interface RunRow { id:string;actor:string;status:string;created_at:string;closed_at:string|null;mode:'interactive'|'batch';expected_count:number;threshold:number;threshold_justification:string;type_version:string;pack_json:string;budget_json:string;text_held:number;manifest_key:string|null;halt_json:string|null }
export interface DocumentRow { run_id:string;fingerprint:string;tag:string;original_filename:string;status:string;input_key:string|null;input_hash:string;extractor_version:string|null;workflow_id:string|null;digest_key:string|null;confidence_key:string|null;reader_key:string|null;notes_json:string;decision_json:string|null;failure_json:string|null;extraction_json:string|null }
export const now=()=>new Date().toISOString();
export async function shaText(text:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');}
export class Store {
 readonly env:Env;
 constructor(env:Env){this.env=env;}
 async run(id:string):Promise<RunRow>{const row=await this.env.DB.prepare('SELECT * FROM runs WHERE id=?').bind(id).first<RunRow>();if(!row)throw new ServerFailure('E_RUN_NOT_FOUND','request','The run does not exist.',404);return row;}
 async documents(id:string):Promise<DocumentRow[]>{return(await this.env.DB.prepare('SELECT * FROM documents WHERE run_id=? ORDER BY tag').bind(id).all<DocumentRow>()).results;}
 async document(id:string,fingerprint:string):Promise<DocumentRow>{const row=await this.env.DB.prepare('SELECT * FROM documents WHERE run_id=? AND fingerprint=?').bind(id,fingerprint).first<DocumentRow>();if(!row)throw new ServerFailure('E_DOCUMENT_NOT_FOUND','request','The document does not exist in this run.',404);return row;}
 async put(runId:string|null,fingerprint:string|null,kind:string,value:unknown,containsText=false,key?:string):Promise<string>{
  const artifactKey=key??`${runId??'system'}/${fingerprint??'run'}/${kind}/${crypto.randomUUID()}.json`;
  // The ledger is written first so a lost response can never leave untracked uploaded text.
  const registered=containsText
   ?await this.env.DB.prepare("INSERT INTO artifacts(key,run_id,fingerprint,kind,contains_text,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM runs WHERE id=? AND status NOT IN('closing','closed'))").bind(artifactKey,runId,fingerprint,kind,1,now(),runId).run()
   :await this.env.DB.prepare('INSERT INTO artifacts(key,run_id,fingerprint,kind,contains_text,created_at) VALUES(?,?,?,?,?,?)').bind(artifactKey,runId,fingerprint,kind,0,now()).run();
  if(registered.meta.changes!==1)throw new ServerFailure('E_RUN_CLOSED','blocker','The run has closed and cannot receive text.');
  let result:R2Object|null;
  try{result=await this.env.ARTIFACTS.put(artifactKey,typeof value==='string'?value:JSON.stringify(value),{onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:'application/json'}});}
  catch(error){await this.event(runId,fingerprint,'artifact','write_uncertain',{key:artifactKey});throw new ServerFailure('E_ARTIFACT_WRITE','blocker','The artifact write outcome is uncertain. Its known key remains recorded until completion can be verified.');}
  if(!result)throw new ServerFailure('E_ARTIFACT_EXISTS','blocker','An immutable artifact already exists. It was not overwritten.');
  await this.env.DB.prepare("UPDATE artifacts SET state='complete' WHERE key=?").bind(artifactKey).run();
  if(containsText&&runId){
   const current=await this.run(runId);
   if(current.status==='closing'||current.status==='closed'){
    await this.env.ARTIFACTS.delete(artifactKey);
    await this.env.DB.prepare('UPDATE artifacts SET deleted_at=? WHERE key=?').bind(now(),artifactKey).run();
    throw new ServerFailure('E_RUN_CLOSED','blocker','The run closed while text was being stored. The late text write was deleted.');
   }
  }
  return artifactKey;
 }
 async putRawStream(runId:string,fingerprint:string,body:ReadableStream<Uint8Array>,key:string):Promise<string>{
  await this.env.DB.prepare('INSERT INTO artifacts(key,run_id,fingerprint,kind,contains_text,created_at) VALUES(?,?,?, ?,0,?)').bind(key,runId,fingerprint,'vendor_raw_bytes',now()).run();
  const saved=await this.env.ARTIFACTS.put(key,body,{onlyIf:new Headers({'If-None-Match':'*'})});
  if(!saved)throw new ServerFailure('E_ARTIFACT_EXISTS','blocker','A raw response artifact already exists.');
  await this.env.DB.prepare("UPDATE artifacts SET state='complete' WHERE key=?").bind(key).run();return key;
 }
 async json<T>(key:string):Promise<T>{const object=await this.env.ARTIFACTS.get(key);if(!object)throw new ServerFailure('E_ARTIFACT_MISSING','blocker','A recorded artifact is missing.');return await object.json<T>();}
 async text(key:string):Promise<string>{const object=await this.env.ARTIFACTS.get(key);if(!object)throw new ServerFailure('E_ARTIFACT_MISSING','blocker','A recorded artifact is missing.');return object.text();}
 async event(runId:string|null,fingerprint:string|null,stage:string,kind:string,details:unknown,elapsed:number|null=null):Promise<void>{await this.env.DB.prepare('INSERT INTO events(id,run_id,fingerprint,created_at,stage,kind,elapsed_ms,details_json) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),runId,fingerprint,now(),stage,kind,elapsed,JSON.stringify(details)).run();}
 async spend(runId:string):Promise<string>{const rows=await this.env.DB.prepare('SELECT cost_nano FROM vendor_calls WHERE run_id=? AND cost_nano IS NOT NULL').bind(runId).all<{cost_nano:string}>();return rows.results.reduce((sum,row)=>sum+BigInt(row.cost_nano),0n).toString();}
 async unaccounted(runId:string):Promise<number>{return(await this.env.DB.prepare("SELECT COUNT(*) AS count FROM vendor_calls WHERE run_id=? AND role!='batch_metadata' AND cost_nano IS NULL").bind(runId).first<{count:number}>())?.count??0;}
 checkpoints(runId:string,fingerprint:string):CheckpointStore {
  return {
   claim:async(name)=>{
    const result=await this.env.DB.prepare("INSERT OR IGNORE INTO checkpoints(run_id,fingerprint,name,status,started_at) VALUES(?,?,?,'running',?)").bind(runId,fingerprint,name,now()).run();
    if(result.meta.changes===1)return{state:'claimed'};
    const prior=await this.env.DB.prepare('SELECT status,artifact_key,error_code,error_kind,error_detail FROM checkpoints WHERE run_id=? AND fingerprint=? AND name=?').bind(runId,fingerprint,name).first<{status:string;artifact_key:string|null;error_code:string|null;error_kind:'blocker'|'document'|'request'|null;error_detail:string|null}>();
    if(prior?.status==='complete'&&prior.artifact_key)return{state:'complete',key:prior.artifact_key};
    if(prior?.status==='failed'&&prior.error_code&&prior.error_kind&&prior.error_detail)return{state:'failed',error:{code:prior.error_code,kind:prior.error_kind,message:prior.error_detail}};
    return{state:'uncertain'};
   },
   finish:async(name,key)=>{await this.env.DB.prepare("UPDATE checkpoints SET status='complete',artifact_key=?,finished_at=? WHERE run_id=? AND fingerprint=? AND name=? AND status='running'").bind(key,now(),runId,fingerprint,name).run();},
   fail:async(name,error)=>{await this.env.DB.prepare("UPDATE checkpoints SET status='failed',error_code=?,error_kind=?,error_detail=?,finished_at=? WHERE run_id=? AND fingerprint=? AND name=? AND status='running'").bind(error.code,error.kind,error.message,now(),runId,fingerprint,name).run();},
  };
 }
 async halt(runId:string,details:unknown):Promise<void>{await this.env.DB.prepare("UPDATE runs SET status='halted',halt_json=? WHERE id=? AND status NOT IN('closing','closed')").bind(JSON.stringify(details),runId).run();await this.event(runId,null,'run','halted',details);}
 async close(runId:string,actor:string):Promise<void>{
  const run=await this.run(runId);if(run.status==='closed')return;
  await this.env.DB.prepare("UPDATE runs SET status='closing' WHERE id=? AND status!='closed'").bind(runId).run();
  await this.event(runId,null,'closure','requested',{actor});
  // Mark closing first: every workflow guard now refuses another vendor call.
  await reconcileTextWrites({
   pendingKeys:async()=> (await this.env.DB.prepare("SELECT key FROM artifacts WHERE run_id=? AND contains_text=1 AND state='writing'").bind(runId).all<{key:string}>()).results.map(row=>row.key),
   exists:async key=>!!await this.env.ARTIFACTS.head(key),
   wasRejected:async _key=>false, // A rejected binding Promise does not prove that no server write occurred.
   markComplete:async key=>{await this.env.DB.prepare("UPDATE artifacts SET state='complete' WHERE key=?").bind(key).run();await this.event(runId,null,'closure','write_reconciled',{key,actor});},
  });
  const uncertainStages=await this.env.DB.prepare("SELECT name FROM checkpoints WHERE run_id=? AND (name LIKE 'batch-%-upload' OR name LIKE 'batch-%-create') AND status!='complete'").bind(runId).all<{name:string}>();
  for(const item of uncertainStages.results){
   const match=/^batch-(\d+)-(\d+)-(upload|create)$/.exec(item.name);
   if(!match)throw new ServerFailure('E_BATCH_CLOSURE_UNCERTAIN','blocker','An interrupted Batch operation cannot be matched to its remote input ledger.');
   const job=await this.env.DB.prepare('SELECT input_file_id,remote_batch_id FROM batch_jobs WHERE id=? AND run_id=?').bind(`${runId}-g${match[1]}-s${match[2]}`,runId).first<{input_file_id:string|null;remote_batch_id:string|null}>();
   if(!job?.input_file_id||(match[3]==='create'&&!job.remote_batch_id))throw new ServerFailure('E_BATCH_CLOSURE_UNCERTAIN','blocker','A Batch upload or creation has an uncertain remote identity. Recover its recorded response before claiming that text has been removed.');
  }
  // A retained deletion acknowledgement can reconcile an interrupted ledger update without another DELETE.
  const receipts=await this.env.DB.prepare("SELECT key FROM artifacts WHERE run_id=? AND kind='batch_cleanup_raw' AND state='complete'").bind(runId).all<{key:string}>();
  for(const receipt of receipts.results){
   const raw=await this.json<BatchCleanupRaw>(receipt.key);
   if(raw.operation!=='delete'||raw.networkFailure||raw.status===null||raw.status<200||raw.status>=300||raw.raw===null)continue;
   let acknowledgement:unknown;
   try{acknowledgement=JSON.parse(raw.raw);}catch{continue;/* A malformed retained receipt cannot prove deletion. */}
   if(acknowledgement&&typeof acknowledgement==='object'&&'id' in acknowledgement&&'deleted' in acknowledgement&&acknowledgement.id===raw.resourceId&&acknowledgement.deleted===true)
    await this.env.DB.prepare("UPDATE batch_jobs SET state='input_deleted' WHERE run_id=? AND input_file_id=?").bind(runId,raw.resourceId).run();
  }
  const jobs=await this.env.DB.prepare("SELECT input_file_id,remote_batch_id FROM batch_jobs WHERE run_id=? AND input_file_id IS NOT NULL AND state!='input_deleted'").bind(runId).all<{input_file_id:string;remote_batch_id:string|null}>();
  if(jobs.results.some(job=>job.remote_batch_id===null)){
   const uncertain=await this.env.DB.prepare("SELECT name FROM checkpoints WHERE run_id=? AND name LIKE 'batch-%-create' AND status!='complete' LIMIT 1").bind(runId).first();
   if(uncertain)throw new ServerFailure('E_BATCH_CLOSURE_UNCERTAIN','blocker','A remote Batch creation has an uncertain outcome. Its identity must be recovered before input cleanup can be confirmed.');
  }
  const cleanup=await cancelAndDeleteBatchInputs(jobs.results.map(job=>({batchId:job.remote_batch_id,inputFileId:job.input_file_id})),{
   fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(60000)}),readSecret:()=>this.env.OPENAI_API_KEY.get(),
   persistRaw:async raw=>{await this.put(runId,null,'batch_cleanup_raw',raw);},
   recordCleanup:async result=>{await this.event(runId,null,'batch_cleanup',result.stage,{...result,actor});if(result.stage==='deleted')await this.env.DB.prepare("UPDATE batch_jobs SET state='input_deleted' WHERE run_id=? AND input_file_id=?").bind(runId,result.inputFileId).run();},
  });
  if(cleanup.pending)throw new ServerFailure('E_BATCH_CLEANUP_PENDING','blocker','The remote Batch is cancelling. Explicitly close the run again after cancellation finishes; text is still held.');
  const rows=await this.env.DB.prepare('SELECT key FROM artifacts WHERE run_id=? AND contains_text=1 AND deleted_at IS NULL').bind(runId).all<{key:string}>();
  for(const row of rows.results){await this.env.ARTIFACTS.delete(row.key);await this.env.DB.prepare("UPDATE artifacts SET deleted_at=?,state='complete' WHERE key=? AND deleted_at IS NULL").bind(now(),row.key).run();}
  await this.env.DB.prepare("UPDATE runs SET status='closed',closed_at=?,text_held=0 WHERE id=?").bind(now(),runId).run();
  await this.event(runId,null,'closure','completed',{actor});
 }
}