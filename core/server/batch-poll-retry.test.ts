import test from 'node:test';
import assert from 'node:assert/strict';
import { BatchReadRateLimitFailure } from '../vendors/batch.ts';
import { pollWithReadRetries,batchReadRetryDelay } from './batch-runner.ts';
function harness(){
 const values=new Map<string,unknown>(),events:string[]=[];let sequence=0;
 const runner={
  accountingStage:async(name:string,_batchId:string,action:()=>Promise<unknown>)=>{events.push('stage:'+name);const key='key-'+ ++sequence;values.set(key,await action());return key;},
  waitAccounting:async(name:string,delay:number,batchId:string)=>{assert.equal(batchId,'batch_1');events.push('sleep:'+name+':'+delay);},
  store:{json:async<T>(key:string)=>values.get(key) as T},
 };
 return{runner,events};
}
test('poll temporary 429 is persisted by the stage, then waits outside it with unique names',async()=>{
 const h=harness();let calls=0;
 const value=await pollWithReadRetries(h.runner as never,'poll-0','batch_1',async()=>{if(++calls===1)throw new BatchReadRateLimitFailure('2','raw-1');return{id:'batch_1'} as never;});
 assert.equal((value as {id:string}).id,'batch_1');
 assert.deepEqual(h.events,['stage:poll-0-read-1','sleep:poll-0-rate-limit-delay-1:30000','stage:poll-0-read-2']);
});
test('poll temporary 429 is bounded without a fourth read or sleep',async()=>{
 const h=harness();let calls=0;
 await assert.rejects(pollWithReadRetries(h.runner as never,'poll-1','batch_1',async()=>{calls++;throw new BatchReadRateLimitFailure(null,'raw');}),{code:'E_BATCH_READ_RATE_LIMIT'});
 assert.equal(calls,3);assert.deepEqual(h.events,['stage:poll-1-read-1','sleep:poll-1-rate-limit-delay-1:30000','stage:poll-1-read-2','sleep:poll-1-rate-limit-delay-2:30000','stage:poll-1-read-3']);
});


test('Batch polling rejects malformed delays and hints beyond the durable sleep limit',()=>{
 const now=Date.UTC(2026,8,22);
 for(const header of ['-1','+1','.5','1.','31536001'])assert.throws(()=>batchReadRetryDelay(header,now),{code:'E_RETRY_AFTER'});
 assert.equal(batchReadRetryDelay('2',now),30000);assert.equal(batchReadRetryDelay(null,now),30000);
 assert.equal(batchReadRetryDelay('31536000',now),31536000000);
});
