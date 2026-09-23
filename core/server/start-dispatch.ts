export interface DispatchDocument {fingerprint:string;status:string;workflow_id:string|null}
export interface DispatchDependencies {
 readStatus():Promise<string>;
 readDocuments():Promise<readonly DispatchDocument[]>;
 create(fingerprint:string):Promise<void>;
 /** The database update must still be conditional on status='running'. */
 markComplete():Promise<void>;
}
export interface DispatchResult {started:number;pending:number;status:string}
const eligible=(document:DispatchDocument)=>document.status!=='complete'&&document.workflow_id===null;

/** Dispatch a bounded page; observation of a halt never restarts or cancels prior work. */
export async function dispatchRunDocuments(deps:DispatchDependencies):Promise<DispatchResult>{
 let started=0,status=await deps.readStatus();
 if(status!=='running')return{started,pending:0,status};
 const documents=await deps.readDocuments();
 for(const document of documents.filter(eligible).slice(0,50)){
  status=await deps.readStatus();
  if(status!=='running')return{started,pending:0,status};
  await deps.create(document.fingerprint);started++;
 }
 const latest=await deps.readDocuments();
 status=await deps.readStatus();
 if(status!=='running')return{started,pending:0,status};
 if(latest.every(document=>document.status==='complete')){
  await deps.markComplete();status=await deps.readStatus();
 }
 return{started,pending:status==='running'?latest.filter(eligible).length:0,status};
}
