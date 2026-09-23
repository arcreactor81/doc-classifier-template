import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchRunDocuments,type DispatchDocument} from './start-dispatch.ts';

function fixture(count:number){
 let status='running',completed=0;
 const documents:DispatchDocument[]=Array.from({length:count},(_,index)=>({fingerprint:String(index),status:'uploaded',workflow_id:null}));
 const created:string[]=[];
 return{documents,created,setStatus:(value:string)=>{status=value;},completed:()=>completed,deps:{
  readStatus:async()=>status,
  readDocuments:async()=>documents.map(document=>({...document})),
  create:async(fingerprint:string)=>{created.push(fingerprint);documents.find(document=>document.fingerprint===fingerprint)!.workflow_id='instance-'+fingerprint;},
  markComplete:async()=>{completed++;if(status==='running')status='complete';},
 }};
}

test('dispatch stops after observing a concurrent halt without creating further workflows',async()=>{
 for(const count of [1,5]){
  const f=fixture(count),create=f.deps.create;
  f.deps.create=async fingerprint=>{await create(fingerprint);f.setStatus('halted');};
  assert.deepEqual(await dispatchRunDocuments(f.deps),{started:1,pending:0,status:'halted'});
  assert.deepEqual(f.created,['0']);assert.equal(f.completed(),0);
 }
});

test('dispatch does not mutate runs that are not running',async()=>{
 for(const state of ['uploading','halted','complete','closing','closed']){
  const f=fixture(3);f.setStatus(state);
  f.deps.readDocuments=async()=>{throw new Error('Inactive runs need no dispatch listing.');};
  assert.deepEqual(await dispatchRunDocuments(f.deps),{started:0,pending:0,status:state});
  assert.deepEqual(f.created,[]);assert.equal(f.completed(),0);
 }
});

test('dispatch keeps the existing fifty-document bound and counts all undispatched active documents',async()=>{
 const f=fixture(64);f.documents[0]!.status='complete';f.documents[1]!.workflow_id='existing-instance';
 assert.deepEqual(await dispatchRunDocuments(f.deps),{started:50,pending:12,status:'running'});
 assert.equal(f.created.length,50);assert.equal(f.created[0],'2');assert.equal(f.completed(),0);
});

test('dispatch conditionally completes a run only when every document is complete',async()=>{
 const f=fixture(3);for(const document of f.documents)document.status='complete';
 assert.deepEqual(await dispatchRunDocuments(f.deps),{started:0,pending:0,status:'complete'});
 assert.deepEqual(f.created,[]);assert.equal(f.completed(),1);
 const pending=fixture(2);
 assert.deepEqual(await dispatchRunDocuments(pending.deps),{started:2,pending:0,status:'running'});
 assert.equal(pending.completed(),0);
});

test('dispatch reports the persisted final status when completion loses a concurrent halt race',async()=>{
 const f=fixture(1);f.documents[0]!.status='complete';
 f.deps.markComplete=async()=>{f.setStatus('halted');};
 assert.deepEqual(await dispatchRunDocuments(f.deps),{started:0,pending:0,status:'halted'});
});
