import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowReference} from './workflow-ack.ts';
const inactive=()=>new Error('Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.');
test('lost outer acknowledgement returns completed key without repeating action or circuit update',async()=>{
 let actions=0,circuit=0,reads=0;const events:string[]=[];
 const key=await workflowReference('confidence-circuit-outcome',{execute:async callback=>{await callback();throw inactive();},checkpoint:async()=>{actions++;circuit++;return 'durable-key';},readCompleted:async()=>{reads++;return null;},recovered:async source=>{events.push(source);}});
 assert.equal(key,'durable-key');assert.equal(actions,1);assert.equal(circuit,1);assert.equal(reads,0);assert.deepEqual(events,['callback']);
});
test('lost acknowledgement before callback uses only completed ledger without action replay',async()=>{
 let actions=0;assert.equal(await workflowReference('reader-http-1',{execute:async()=>{throw inactive();},checkpoint:async()=>{actions++;return 'wrong';},readCompleted:async()=> 'saved-response',recovered:async()=>{}}),'saved-response');assert.equal(actions,0);
});
test('same inactive error thrown by callback is not recovered from ledger',async()=>{
 const cause=inactive();let reads=0;
 await assert.rejects(workflowReference('reader-http-1',{execute:callback=>callback(),checkpoint:async()=>{throw cause;},readCompleted:async()=>{reads++;return 'saved';},recovered:async()=>{}}),error=>error===cause);assert.equal(reads,0);
});
test('domain callback failure survives a replaced outer error',async()=>{
 const cause=Object.assign(new Error('kill'),{code:'E_KILL_SWITCH'});
 await assert.rejects(workflowReference('reader-http-1',{execute:async callback=>{try{await callback();}catch{}throw inactive();},checkpoint:async()=>{throw cause;},readCompleted:async()=> 'saved',recovered:async()=>{}}),error=>error===cause);
});
test('unrelated outer error is never recovered',async()=>{
 const cause=new Error('storage unavailable');let reads=0;
 await assert.rejects(workflowReference('reader-http-1',{execute:async callback=>{await callback();throw cause;},checkpoint:async()=> 'saved',readCompleted:async()=>{reads++;return 'saved';},recovered:async()=>{}}),error=>error===cause);assert.equal(reads,0);
});
for(const key of [null,'','   '])test('missing or empty ledger key is an explicit interruption: '+JSON.stringify(key),async()=>{
 await assert.rejects(workflowReference('reader-http-1',{execute:async()=>{throw inactive();},checkpoint:async()=> 'unused',readCompleted:async()=>key,recovered:async()=>{throw new Error('must not recover');}}),error=>error instanceof Error&&'code' in error&&error.code==='E_WORKFLOW_INTERRUPTED'&&error.message.includes('reader-http-1'));
});
test('empty callback key does not reconcile or recover',async()=>{
 let reads=0;await assert.rejects(workflowReference('empty',{execute:async callback=>{await callback();throw inactive();},checkpoint:async()=> '',readCompleted:async()=>{reads++;return 'saved';},recovered:async()=>{}}),{code:'E_WORKFLOW_INTERRUPTED'});assert.equal(reads,0);
});
test('recovery event storage failure propagates without action retry',async()=>{
 let actions=0;const failure=Object.assign(new Error('D1 unavailable'),{code:'E_STORAGE_D1'});
 await assert.rejects(workflowReference('stage',{execute:async callback=>{await callback();throw inactive();},checkpoint:async()=>{actions++;return 'saved';},readCompleted:async()=>null,recovered:async()=>{throw failure;}}),error=>error===failure);assert.equal(actions,1);
});
test('normal step returns unchanged and does not touch reconciliation',async()=>{
 assert.equal(await workflowReference('stage',{execute:callback=>callback(),checkpoint:async()=> 'saved',readCompleted:async()=>{throw new Error('unexpected');},recovered:async()=>{throw new Error('unexpected');}}),'saved');
});
