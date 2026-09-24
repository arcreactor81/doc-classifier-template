import {ServerFailure} from './errors.ts';
const inactiveMessage='Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.';
export interface WorkflowReferenceDependencies {
 execute(callback:()=>Promise<string>):Promise<string>;
 checkpoint():Promise<string>;
 /** Read only: never claim, reset, or re-execute an uncertain stage. */
 readCompleted():Promise<string|null>;
 recovered(source:'callback'|'ledger'):Promise<void>;
}
/** Recover a lost Workflow acknowledgement only when D1 already owns the result. */
export async function workflowReference(name:string,deps:WorkflowReferenceDependencies):Promise<string>{
 let entered=false,completed=false,callbackFailed=false,callbackError:unknown,key:string|undefined;
 try{return await deps.execute(async()=>{
  entered=true;
  try{key=await deps.checkpoint();completed=true;return key;}
  catch(error){callbackFailed=true;callbackError=error;throw error;}
 });}catch(error){
  // A domain/storage error from the callback is not an acknowledgement failure,
  // even if the runtime replaces its outer exception with an inactive-instance error.
  if(callbackFailed)throw callbackError;
  if(!(error instanceof Error)||error.message!==inactiveMessage)throw error;
  const durableKey=completed?key:await deps.readCompleted();
  if(typeof durableKey==='string'&&durableKey.trim().length>0){
   await deps.recovered(completed?'callback':'ledger');
   return durableKey;
  }
  throw new ServerFailure('E_WORKFLOW_INTERRUPTED','blocker',`Workflow stage "${name}" lost its active runtime connection ${entered?'during completion':'before acknowledgement'} and has no confirmed durable result. Its action has not been repeated; preserve this run for explicit recovery.`);
 }
}
