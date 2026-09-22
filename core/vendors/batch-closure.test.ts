import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelAndDeleteBatchInputs, type BatchCleanupDependencies } from './batch-closure.ts';
function harness(responses: (unknown | Error)[]) {
 const calls: {url:string;method:string}[] = [], events:string[] = [];
 const deps:BatchCleanupDependencies = {
  fetch:async(url,init)=>{calls.push({url,method:init.method!});const next=responses.shift();if(next instanceof Error)throw next;return new Response(JSON.stringify(next));},
  readSecret:async()=> 'secret',persistRaw:async()=>{events.push('raw');},recordCleanup:async(event)=>{events.push(event.stage);},
 };
 return {deps,calls,events};
}
const job={batchId:'batch_1',inputFileId:'file_1'};
const snapshot=(status:string)=>({id:'batch_1',input_file_id:'file_1',status,output_file_id:'file_output'});
test('closure cancels active Batch but retains input until terminal confirmation',async()=>{
 const h=harness([snapshot('in_progress'),snapshot('cancelling')]);
 assert.deepEqual(await cancelAndDeleteBatchInputs([job],h.deps),{pending:true,deletedInputFileIds:[]});
 assert.deepEqual(h.calls.map(c=>c.method),['GET','POST']);
 assert.deepEqual(h.events,['raw','raw','pending']);
});
test('terminal closure deletes only the recorded input file and persists before acknowledging',async()=>{
 const h=harness([snapshot('completed'),{id:'file_1',object:'file',deleted:true}]);
 assert.deepEqual(await cancelAndDeleteBatchInputs([job],h.deps),{pending:false,deletedInputFileIds:['file_1']});
 assert.equal(h.calls[1]?.url,'https://api.openai.com/v1/files/file_1');
 assert.deepEqual(h.events,['raw','raw','deleted']);
});
test('closure already cancelling does not resubmit cancellation and empty jobs need no secret',async()=>{
 const h=harness([snapshot('cancelling')]);
 assert.equal((await cancelAndDeleteBatchInputs([job],h.deps)).pending,true);
 assert.equal(h.calls.length,1);
 h.deps.readSecret=async()=>{throw new Error('must not read');};
 assert.deepEqual(await cancelAndDeleteBatchInputs([],h.deps),{pending:false,deletedInputFileIds:[]});
});
test('orphan input deletes without Batch calls and malformed acknowledgement blocks',async()=>{
 const h=harness([{id:'file_other',deleted:true}]);
 await assert.rejects(cancelAndDeleteBatchInputs([{batchId:null,inputFileId:'file_1'}],h.deps),/deletion acknowledgement/);
 assert.deepEqual(h.events,['raw']);
});
test('network uncertainty is recorded once with no retries or secrets',async()=>{
 const h=harness([new Error('secret')]);
 await assert.rejects(cancelAndDeleteBatchInputs([job],h.deps),/uncertain/);
 assert.equal(h.calls.length,1);assert.deepEqual(h.events,['raw']);
});
test('unexpected remote input identity blocks deletion and malformed ids never call vendor',async()=>{
 const h=harness([{...snapshot('completed'),input_file_id:'file_other'}]);
 await assert.rejects(cancelAndDeleteBatchInputs([job],h.deps),/identity/);
 assert.equal(h.calls.length,1);
 await assert.rejects(cancelAndDeleteBatchInputs([{...job,inputFileId:'../other'}],h.deps),/identifier/);
 assert.equal(h.calls.length,1);
});
