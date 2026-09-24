import type {Store} from './store.ts';
import {ServerFailure} from './errors.ts';
/** An old execution must not act after explicit recovery establishes a new generation. */
export async function assertWorkflowGeneration(store:Store,runId:string,recoveryId?:string):Promise<void>{
 const latest=await store.env.DB.prepare('SELECT id FROM run_recoveries WHERE run_id=? ORDER BY generation DESC LIMIT 1').bind(runId).first<{id:string}>();
 if((latest?.id??null)!==(recoveryId??null))throw new ServerFailure('E_WORKFLOW_SUPERSEDED','blocker','This workflow belongs to an earlier execution generation and cannot submit work or stop the continued run.');
}
