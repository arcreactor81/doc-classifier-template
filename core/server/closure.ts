import { ServerFailure } from './errors.ts';
export interface TextWriteReconciliation {
 pendingKeys():Promise<string[]>;
 exists(key:string):Promise<boolean>;
 wasRejected(key:string):Promise<boolean>;
 markComplete(key:string):Promise<void>;
}
/** Only an observed commit or recorded settled rejection proves a write is no longer pending. */
export async function reconcileTextWrites(deps:TextWriteReconciliation):Promise<void>{
 for(const key of await deps.pendingKeys()){
  if(await deps.exists(key)||await deps.wasRejected(key))await deps.markComplete(key);
  else throw new ServerFailure('E_CLOSE_WRITES_PENDING','blocker','A text write has an uncertain outcome. The run remains closing and text-held until its completion can be verified; another click cannot prove completion.');
 }
}