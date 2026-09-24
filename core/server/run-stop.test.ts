import test from 'node:test';
import assert from 'node:assert/strict';
import {readRunStopReason} from './run-stop.ts';
import type {Store,RunRow} from './store.ts';
function fixture(first:unknown,call:unknown=null,raw:unknown=null){
 let reads=0;
 const store={env:{DB:{prepare:(sql:string)=>({bind:()=>({first:async()=>sql.includes('FROM events')?first:call})})}},json:async()=>{reads++;return raw;}} as unknown as Store;
 return{store,reads:()=>reads};
}
test('historical first halt evidence wins over overwritten last stop without mutating records',async()=>{
 const run={id:'run',status:'halted',halt_json:JSON.stringify({code:'E_RUN_STOPPED',message:'Later stop'})} as RunRow;
 const original=JSON.stringify(run);const f=fixture({created_at:'2026-09-23',details_json:JSON.stringify({code:'E_SPEND_UNACCOUNTED',message:'Missing usage'})});
 const result=await readRunStopReason(f.store,run);assert.equal(result?.code,'E_SPEND_UNACCOUNTED');assert.equal(result?.headline,'Missing usage');assert.equal(JSON.stringify(run),original);assert.equal(f.reads(),0);
});
test('known confidence size rejection is explained without claiming zero cost or exposing raw fields',async()=>{
 const run={id:'run',status:'halted',halt_json:JSON.stringify({code:'E_SPEND_UNACCOUNTED',message:'Missing usage'})} as RunRow;
 const f=fixture(null,{role:'confidence',status:400,raw_key:'run/doc/raw/a.json',fingerprint:'doc',attempt_id:'a',original_filename:'document.pdf'},{raw:JSON.stringify({error_type:'max_tokens_exceeded',private_detail:'not for display'})});
 const result=await readRunStopReason(f.store,run);assert.equal(result?.code,'E_SPEND_UNACCOUNTED');assert.match(result?.headline??'',/token limit/);assert.equal(result?.details.providerErrorType,'max_tokens_exceeded');assert.equal(result?.details.costKnown,false);assert.ok(!JSON.stringify(result).includes('private_detail'));assert.ok(!JSON.stringify(result).includes('not for display'));
});
test('active runs expose no stop and legacy stopped runs keep explicit recorded cause',async()=>{
 const f=fixture(null);assert.equal(await readRunStopReason(f.store,{id:'run',status:'running'} as RunRow),null);
 const issue=await readRunStopReason(f.store,{id:'run',status:'halted',halt_json:JSON.stringify({code:'E_KILL_SWITCH',actor:'person'})} as RunRow);assert.equal(issue?.code,'E_KILL_SWITCH');
});

test('historical storage wrapper error shows retained unknown response without rewriting recorded cause',async()=>{
 const run={id:'run',status:'halted',halt_json:JSON.stringify({code:'E_RAW_PERSIST',message:'Raw vendor response could not be stored.'})} as RunRow;
 const before=JSON.stringify(run);const f=fixture(null,{role:'confidence',status:520,raw_key:'run/doc/raw/a.json',fingerprint:'doc',attempt_id:'a',original_filename:'document.pdf'},{status:520,raw:'error code: 520\n',privateHeader:'not displayed'});
 const result=await readRunStopReason(f.store,run);assert.equal(result?.code,'E_RAW_PERSIST');assert.equal(result?.details.rawResponseRetained,true);assert.equal(result?.details.httpStatus,520);assert.equal(result?.details.costKnown,false);assert.equal(JSON.stringify(run),before);assert.ok(!JSON.stringify(result).includes('privateHeader'));
});

test('known runtime reset has a concrete continuation explanation while preserving original code',async()=>{
 const message='Durable Object reset because its code was updated.';const run={id:'run',status:'halted',halt_json:JSON.stringify({code:'E_INTERNAL',message})} as RunRow;
 const f=fixture(null);const result=await readRunStopReason(f.store,run);assert.equal(result?.code,'E_INTERNAL');assert.match(result?.headline??'',/Cloudflare.*interrupted/);assert.equal(result?.details.runtimeReset,message);assert.match(result?.action??'',/continuation/);
});
