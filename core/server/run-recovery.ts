import {Store,now,type RunRow} from './store.ts';
import {ServerFailure} from './errors.ts';
export interface RecoveryReadiness {assertReady(run:RunRow):Promise<void>}
interface RecoveryPlan {id:string;run_id:string;generation:number;actor:string}
interface RecoveryItem {fingerprint:string;old_workflow_id:string|null;new_workflow_id:string;state:string}
const reject=(message:string):never=>{throw new ServerFailure('E_RECOVERY_UNSAFE','request',message,409);};
const terminal=new Set(['errored','terminated','complete']);
async function owner(store:Store,id:string,actor:string){const run=await store.run(id);if(run.actor!==actor)throw new ServerFailure('E_FORBIDDEN','request','This run belongs to another account.',403);return run;}
async function latest(store:Store,id:string){return store.env.DB.prepare('SELECT * FROM run_recoveries WHERE run_id=? ORDER BY generation DESC LIMIT 1').bind(id).first<RecoveryPlan>();}
export function canOfferRecovery(run:Pick<RunRow,'status'|'halt_json'>):boolean{
 if(run.status!=='halted')return false;
 try{const halt=JSON.parse(run.halt_json??'{}');return halt.code==='E_WORKFLOW_INTERRUPTED'||halt.code==='E_INTERNAL'&&halt.message==='Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.';}catch{return false;}
}
/** No calls to vendors or mutation. Unknown Workflow status is never evidence of termination. */
export async function inspectRunRecovery(store:Store,id:string,actor:string){
 const run=await owner(store,id,actor);
 if(run.status!=='halted')reject('Only an interrupted, halted run can be continued.');
 const halt=JSON.parse(run.halt_json??'{}') as {code?:string;message?:string;detail?:string};
 if(halt.code!=='E_WORKFLOW_INTERRUPTED'&&!((halt.message??halt.detail)==='Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.'&&halt.code==='E_INTERNAL'))reject('This stop requires review before continuation.');
 const documents=await store.documents(id);
 if(!run.text_held||documents.length!==run.expected_count)reject('All original extracted inputs must remain available.');
 if(await store.unaccounted(id)||await store.pendingAccounting(id))reject('Spending must be completely accounted before continuation.');
 for(const sql of ["SELECT 1 FROM checkpoints WHERE run_id=? AND status!='complete' LIMIT 1","SELECT 1 FROM artifacts WHERE run_id=? AND state!='complete' LIMIT 1","SELECT 1 FROM batch_jobs WHERE run_id=? LIMIT 1", "SELECT 1 FROM checkpoints c WHERE c.run_id=? AND (c.name LIKE 'confidence-http-%' OR c.name LIKE 'reader-http-%' OR c.name LIKE 'recovery-http-%') AND NOT EXISTS(SELECT 1 FROM vendor_calls v WHERE v.attempt_id=c.run_id||'-'||c.fingerprint||'-'||replace(c.name,'-http-','-')) LIMIT 1"]){if(await store.env.DB.prepare(sql).bind(id).first())reject('An unfinished operation or Batch submission prevents safe continuation.');}
 // Independent read-only checks are bounded to eight documents at once. A page
 // settles fully before propagating a refusal; no mutation can overlap a check.
 for(let offset=0;offset<documents.length;offset+=8){
  const checked=await Promise.allSettled(documents.slice(offset,offset+8).map(async document=>{
   if(document.workflow_id){let status:string;try{status=(await(await store.env.DOCUMENT_WORKFLOW.get(document.workflow_id)).status()).status;}catch{reject('An original workflow status could not be verified.');}if(!terminal.has(status!))reject('Every original workflow must have stopped before continuation.');}
   if(document.status!=='complete'){
    if(document.failure_json||!document.input_key)reject('Failed documents cannot be retried by continuation.');
    if(!await store.env.ARTIFACTS.head(document.input_key!))reject('A retained input is missing.');
   }
  }));
  for(const result of checked)if(result.status==='rejected')throw result.reason;
 }
 const current=await owner(store,id,actor);
 if(current.status!=='halted'||current.halt_json!==run.halt_json)reject('Run state changed while its continuation was being checked.');
 const currentDocuments=await store.documents(id);
 if(currentDocuments.length!==documents.length||currentDocuments.some((document,index)=>document.fingerprint!==documents[index]!.fingerprint||document.workflow_id!==documents[index]!.workflow_id||document.status!==documents[index]!.status||document.input_key!==documents[index]!.input_key))reject('Document state changed while its continuation was being checked.');
 return{run,documents:documents.filter(d=>d.status!=='complete')};
}
/** Explicit continuation allocates fresh execution identities, never restarts old Workflows. */
export async function recoverRun(store:Store,id:string,actor:string,options:RecoveryReadiness&{acknowledged:boolean}){
 if(options.acknowledged!==true)reject('Explicit continuation acknowledgement is required.');
 const run=await owner(store,id,actor),existing=await latest(store,id);
 if(run.status==='running'&&existing)return dispatchRecovery(store,id,actor,options);
 const inspected=await inspectRunRecovery(store,id,actor);await options.assertReady(inspected.run);
 if(!inspected.documents.length)reject('There are no unfinished documents to continue.');
 const planId=crypto.randomUUID(),generation=(existing?.generation??0)+1;
 const statements=[store.env.DB.prepare("INSERT INTO run_recoveries(id,run_id,generation,actor,created_at,original_halt_json) SELECT ?,?,?,?,?,halt_json FROM runs WHERE id=? AND status='halted' AND halt_json=?").bind(planId,id,generation,actor,now(),id,inspected.run.halt_json)];
 const items=inspected.documents.map(doc=>({fingerprint:doc.fingerprint,oldId:doc.workflow_id,newId:`recovery-${crypto.randomUUID()}`}));
 statements.push(store.env.DB.prepare("INSERT INTO run_recovery_documents(recovery_id,fingerprint,old_workflow_id,new_workflow_id) SELECT ?,json_extract(value,'$.fingerprint'),json_extract(value,'$.oldId'),json_extract(value,'$.newId') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM run_recoveries WHERE id=?)").bind(planId,JSON.stringify(items),planId));
 statements.push(store.env.DB.prepare("UPDATE documents SET workflow_id=(SELECT new_workflow_id FROM run_recovery_documents WHERE recovery_id=? AND fingerprint=documents.fingerprint) WHERE run_id=? AND fingerprint IN(SELECT fingerprint FROM run_recovery_documents WHERE recovery_id=?)").bind(planId,id,planId));
 statements.push(store.env.DB.prepare("UPDATE runs SET status='running' WHERE id=? AND status='halted' AND EXISTS(SELECT 1 FROM run_recoveries WHERE id=?)").bind(id,planId));
 const result=await store.env.DB.batch(statements);if(result[0]?.meta.changes!==1)reject('Run state changed; reload its status before continuing.');
 return dispatchRecovery(store,id,actor,options);
}
/** A lost create acknowledgement can only be reconciled through the same reserved ID. */
export async function dispatchRecovery(store:Store,id:string,actor:string,options:RecoveryReadiness){
 const run=await owner(store,id,actor),plan=await latest(store,id);if(!plan)reject('There is no saved continuation plan.');
 await options.assertReady(run);if(run.status!=='running')reject('The run is no longer running.');
 const items=(await store.env.DB.prepare("SELECT * FROM run_recovery_documents WHERE recovery_id=? AND state!='started' ORDER BY fingerprint LIMIT 50").bind(plan!.id).all<RecoveryItem>()).results;
 let started=0;
 for(const item of items){
  const current=await owner(store,id,actor);if(current.status!=='running')break;await options.assertReady(current);
  const claimed=await store.env.DB.prepare("UPDATE run_recovery_documents SET state='dispatching' WHERE recovery_id=? AND fingerprint=? AND state='pending'").bind(plan!.id,item.fingerprint).run();
  if(claimed.meta.changes===1){try{await store.env.DOCUMENT_WORKFLOW.create({id:item.new_workflow_id,params:{runId:id,fingerprint:item.fingerprint,recoveryId:plan!.id}});}catch{/* Even a thrown create can have succeeded remotely: reconcile, never resend. */}}
  let status:string;try{status=(await(await store.env.DOCUMENT_WORKFLOW.get(item.new_workflow_id)).status()).status;}catch{reject('The continuation start has an uncertain acknowledgement. Its reserved execution ID is preserved; no replacement was created.');}
  if(!new Set(['queued','running','paused','errored','terminated','complete','waiting','waitingForPause','rollingBack']).has(status!))reject('The continuation execution status is unknown.');
  await store.env.DB.prepare("UPDATE run_recovery_documents SET state='started' WHERE recovery_id=? AND fingerprint=? AND state='dispatching'").bind(plan!.id,item.fingerprint).run();started++;
 }
 const pending=(await store.env.DB.prepare("SELECT COUNT(*) AS count FROM run_recovery_documents WHERE recovery_id=? AND state!='started'").bind(plan!.id).first<{count:number}>())?.count??0;
 return{generation:plan!.generation,started,pending,status:(await store.run(id)).status};
}




/** Lightweight polling metadata; never contacts Workflow control or vendors. */
export async function recoveryProgress(store:Store,id:string,actor:string){
 await owner(store,id,actor);const plan=await latest(store,id);if(!plan)return null;
 const counts=await store.env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN state!='started' THEN 1 ELSE 0 END) AS pending FROM run_recovery_documents WHERE recovery_id=?").bind(plan.id).first<{total:number;pending:number}>();
 return{id:plan.id,generation:plan.generation,total:counts?.total??0,pending:counts?.pending??0};
}
