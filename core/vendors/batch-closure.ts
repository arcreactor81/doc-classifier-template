import { ValidationFailure } from './validate.ts';
export interface BatchCleanupJob { batchId: string | null; inputFileId: string }
export interface BatchCleanupRaw {
 operation: 'retrieve' | 'cancel' | 'delete'; resourceId: string; status: number | null;
 requestId: string | null; raw: string | null; networkFailure: boolean;
}
export interface BatchCleanupEvent extends BatchCleanupJob { stage: 'pending' | 'deleted'; status: string | null }
export interface BatchCleanupDependencies {
 fetch(url: string, init: RequestInit): Promise<Response>;
 readSecret(): Promise<string | null>;
 persistRaw(value: BatchCleanupRaw): Promise<void>;
 recordCleanup(value: BatchCleanupEvent): Promise<void>;
}
const terminal = new Set(['completed', 'failed', 'expired', 'cancelled']);
const statuses = new Set([...terminal, 'validating', 'in_progress', 'finalizing', 'cancelling']);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(message: string): never { throw new ValidationFailure('E_BATCH_CLEANUP', 'blocker', message); }
/** Only call for explicit user closure, with input IDs from the durable run ledger.
 * No inference guard: cleanup must remain available after a kill switch or budget halt.
 * No retries or polling loop. Persist pending, then retry closure explicitly after cancellation.
 */
export async function cancelAndDeleteBatchInputs(jobs: readonly BatchCleanupJob[], deps: BatchCleanupDependencies): Promise<{pending: boolean; deletedInputFileIds: string[]}> {
 const captured = jobs.map(job=>({...job}));
 const files = new Set<string>();
 for (const job of captured) {
  for (const id of [job.inputFileId, ...(job.batchId === null ? [] : [job.batchId])]) if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail('A Batch cleanup identifier is invalid.');
  if (files.has(job.inputFileId)) fail('Batch cleanup input identifiers must be unique.');
  files.add(job.inputFileId);
 }
 if (!captured.length) return {pending:false,deletedInputFileIds:[]};
 let secret: string | null;
 try { secret=await deps.readSecret(); } catch { fail('Reader credentials could not be read for Batch cleanup.'); }
 if (!secret?.trim()) fail('Reader credentials are missing for Batch cleanup.');
 async function request(operation: BatchCleanupRaw['operation'], resourceId: string): Promise<unknown> {
  const path=operation==='delete'?`files/${resourceId}`:`batches/${resourceId}${operation==='cancel'?'/cancel':''}`;
  let response:Response;
  try { response=await deps.fetch(`https://api.openai.com/v1/${path}`,{redirect:'manual',method:operation==='delete'?'DELETE':operation==='cancel'?'POST':'GET',headers:{Authorization:`Bearer ${secret}`}}); }
  catch { await deps.persistRaw({operation,resourceId,status:null,requestId:null,raw:null,networkFailure:true});fail('The Batch cleanup request outcome is uncertain; inspect its audit record before retrying closure.'); }
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0,interrupted=false;
  if (reader) {
   try { while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>1048576){interrupted=true;await reader.cancel();break;}chunks.push(next.value);} }
   catch { interrupted=true; } finally { reader.releaseLock(); }
  }
  const bytes=new Uint8Array(chunks.reduce((sum,item)=>sum+item.length,0));let offset=0;for(const item of chunks){bytes.set(item,offset);offset+=item.length;}
  const raw=new TextDecoder().decode(bytes);
  await deps.persistRaw({operation,resourceId,status:response.status,requestId:response.headers.get('x-request-id'),raw,networkFailure:interrupted});
  if(interrupted)fail('The Batch cleanup response was interrupted or exceeded its metadata limit.');
  if(!response.ok)fail('The vendor rejected Batch cleanup; the run remains open.');
  try{return JSON.parse(raw);}catch{fail('The Batch cleanup response is not valid JSON.');}
 }
 function checkSnapshot(value:unknown,job:BatchCleanupJob):string {
  if(!record(value)||value.id!==job.batchId||value.input_file_id!==job.inputFileId)fail('The remote Batch identity does not match the recorded run input.');
  if(typeof value.status!=='string'||!statuses.has(value.status))fail('The remote Batch cleanup status is unknown.');
  return value.status;
 }
 let pending=false;const deletedInputFileIds:string[]=[];
 for(const job of captured){
  let status:string|null=null;
  if(job.batchId){
   status=checkSnapshot(await request('retrieve',job.batchId),job);
   if(!terminal.has(status)&&status!=='cancelling')status=checkSnapshot(await request('cancel',job.batchId),job);
   if(!terminal.has(status)){pending=true;await deps.recordCleanup({...job,stage:'pending',status});continue;}
  }
  const deletion=await request('delete',job.inputFileId);
  if(!record(deletion)||deletion.id!==job.inputFileId||deletion.deleted!==true)fail('The input-file deletion acknowledgement is invalid.');
  await deps.recordCleanup({...job,stage:'deleted',status});
  deletedInputFileIds.push(job.inputFileId);
 }
 return {pending,deletedInputFileIds};
}
