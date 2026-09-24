import {ServerFailure} from './errors.ts';
export interface WorkflowWaitDependencies {
 now():number;
 /** Recheck the run, kill switch, spending policy and execution generation. */
 guard():Promise<void>;
 sleepUntil(name:string,until:number):Promise<void>;
 recovered(until:number):Promise<void>;
}
const lifecycleMessages=new Set([
 'Durable Object reset because its code was updated.',
 'Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.',
]);
/** The deadline must already be durable. No callback or external action is retried here. */
export async function workflowWait(name:string,until:number,deps:WorkflowWaitDependencies):Promise<void>{
 if(!Number.isSafeInteger(until)||until<0)throw new ServerFailure('E_WORKFLOW_WAIT_STATE','blocker','The persisted workflow wait deadline is invalid.');
 await deps.guard();
 if(deps.now()>=until)return;
 let acknowledgementLost=false;
 try{await deps.sleepUntil(name,until);}
 catch(error){
  if(!(error instanceof Error)||!lifecycleMessages.has(error.message))throw error;
  acknowledgementLost=true;
 }
 // An elapsed clock is structural proof only of waiting, never of a vendor action.
 // An early lifecycle interruption stops explicitly; replay reuses the original deadline.
 if(deps.now()<until)throw new ServerFailure('E_WORKFLOW_INTERRUPTED','blocker',`Workflow wait "${name}" was interrupted before its saved deadline. No action was repeated; preserve this run for explicit recovery.`);
 await deps.guard();
 if(acknowledgementLost)await deps.recovered(until);
}
