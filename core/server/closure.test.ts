import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTextWrites } from './closure.ts';
test('two explicit closure attempts cannot complete while an R2 write is still unresolved', async () => {
 let committed=false,marked=false;
 let resolveWrite!:()=>void;
 const heldPut=new Promise<void>(resolve=>{resolveWrite=()=>{committed=true;resolve();};});
 const deps={pendingKeys:async()=>marked?[]:['input_a'],exists:async()=>committed,wasRejected:async()=>false,markComplete:async()=>{marked=true;}};
 await assert.rejects(reconcileTextWrites(deps),{code:'E_CLOSE_WRITES_PENDING'});
 await assert.rejects(reconcileTextWrites(deps),{code:'E_CLOSE_WRITES_PENDING'});
 assert.equal(marked,false);
 resolveWrite();await heldPut;
 await reconcileTextWrites(deps);assert.equal(marked,true);
});
test('an explicitly recorded completed rejection can be reconciled without inventing an object', async () => {
 let marked=false;
 await reconcileTextWrites({pendingKeys:async()=>['input_a'],exists:async()=>false,wasRejected:async()=>true,markComplete:async()=>{marked=true;}});
 assert.equal(marked,true);
});
test('a rejected transport promise without a visible object remains uncertain', async () => {
 let marked=false;
 await assert.rejects(reconcileTextWrites({pendingKeys:async()=>['input_a'],exists:async()=>false,wasRejected:async()=>false,markComplete:async()=>{marked=true;}}),{code:'E_CLOSE_WRITES_PENDING'});
 assert.equal(marked,false);
});