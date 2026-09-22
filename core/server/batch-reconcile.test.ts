import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSubmittedBatch } from './batch-runner.ts';
import type { Store, RunRow } from './store.ts';
import type { ProjectPack } from '../config/project.ts';
const pin={id:'gpt-5.6-terra',policy:'owner_approved_alias',date:'2026-09-22',reason:'Owner approved'};
const pack={pins:{reader:pin},prices:{verifiedAt:'2026-09-22',source:['verified'],batch:{reader:{inputNanodollarsPerMillion:'1000000000',outputNanodollarsPerMillion:'1000000000'}}}} as unknown as ProjectPack;
const line=(id:string,usage:unknown)=>JSON.stringify({custom_id:id,response:{status_code:200,request_id:id,body:{model:pin.id,usage}},error:null})+'\n';
function fixture(status='halted'){
 const calls=new Map<string,unknown[]>(),events:{stage:string;kind:string}[]=[],reads:string[]=[],http:{url:string;method:string}[]=[];let artifact=0;
 const run={id:'run1',status} as RunRow;
 const env={MODEL_CALLS_ENABLED:'false',OPENAI_API_KEY:{get:async()=> 'test-key'},ARTIFACTS:{put:async()=>({})},DB:{prepare:(sql:string)=>({bind:(...v:unknown[])=>({first:async()=>{
  if(sql.includes('SELECT remote_batch_id'))return v[0]==='batch_1'?{remote_batch_id:'batch_1'}:null;
  if(sql.includes('SELECT id FROM batch_jobs'))return{id:'run1-g0-s1'};
  if(sql.includes('SELECT artifact_key'))return{artifact_key:'plan'};
  throw Error('Unexpected read: '+sql);
 },run:async()=>{
  if(sql.includes('INTO vendor_calls')){const key=String(v[0]);if(calls.has(key))return{meta:{changes:0}};calls.set(key,v);}
  return{meta:{changes:1}};
 }})})}} as unknown as Env;
 const store={env,run:async()=>run,json:async(key:string)=>{reads.push(key);assert.equal(key,'plan');return[[{fingerprint:'doc1',request_key:'never-read-1'},{fingerprint:'doc2',request_key:'never-read-2'}]];},put:async()=> 'raw'+ ++artifact,event:async(_r:unknown,_f:unknown,stage:string,kind:string)=>{events.push({stage,kind});}} as unknown as Store;
 const fetcher=async(url:RequestInfo|URL,init?:RequestInit)=>{http.push({url:String(url),method:init?.method??'GET'});if(String(url).includes('/batches/'))return Response.json({id:'batch_1',input_file_id:'file_input',endpoint:'/v1/responses',completion_window:'24h',status:'cancelled',output_file_id:'file_output',error_file_id:null,request_counts:{total:2,completed:2,failed:0}});
 return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(line('doc1',null)));c.enqueue(new TextEncoder().encode(line('doc2',{input_tokens:10,output_tokens:5,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}})));c.close();}}));};
 return{store,run,calls,events,reads,http,fetcher};
}
test('known halted Batch drains delayed usage with models disabled; unknown first usage does not abandon second charge',async()=>{
 const h=fixture(),prior=globalThis.fetch;globalThis.fetch=h.fetcher;
 try{await reconcileSubmittedBatch(h.store,h.run,pack,'run1-g0-s1','batch_1');await reconcileSubmittedBatch(h.store,h.run,pack,'run1-g0-s1','batch_1');}finally{globalThis.fetch=prior;}
 assert.equal(h.calls.get('run1-g0-s1-doc1')?.[10],null);assert.equal(h.calls.get('run1-g0-s1-doc2')?.[10],'15000');
 assert.equal([...h.calls.values()].filter(v=>v[3]==='reader').length,2);
 assert.ok(h.events.some(v=>v.stage==='batch_accounting'&&v.kind==='reconciled'));
 assert.ok(h.http.every(v=>v.method==='GET'));assert.deepEqual(h.reads,['plan','plan']);
});
test('unknown submitted identity is rejected without any HTTP request',async()=>{
 const h=fixture(),prior=globalThis.fetch;globalThis.fetch=h.fetcher;
 try{await assert.rejects(reconcileSubmittedBatch(h.store,h.run,pack,'run1-g0-s1','other_batch'),/already submitted/i);}finally{globalThis.fetch=prior;}
 assert.equal(h.http.length,0);
});

test('closure accounting reads only metadata after classification has stopped',async()=>{
 for(const status of ['closing','closed']){
  const h=fixture(status),prior=globalThis.fetch;globalThis.fetch=h.fetcher;
  try{await reconcileSubmittedBatch(h.store,h.run,pack,'run1-g0-s1','batch_1');}finally{globalThis.fetch=prior;}
  assert.deepEqual(h.reads,['plan']);assert.ok(h.http.every(row=>row.method==='GET'));
  assert.ok(h.events.some(row=>row.stage==='batch_accounting'&&row.kind==='reconciled'));
 }
});
test('missing completed result keeps submitted accounting pending',async()=>{
 const h=fixture(),prior=globalThis.fetch;
 globalThis.fetch=async(url,init)=>String(url).includes('/files/')?new Response(line('doc1',{input_tokens:10,output_tokens:5,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}})):h.fetcher(url,init);
 try{await assert.rejects(reconcileSubmittedBatch(h.store,h.run,pack,'run1-g0-s1','batch_1'),/no retained usage/i);}finally{globalThis.fetch=prior;}
 assert.ok(!h.events.some(row=>row.stage==='batch_accounting'&&row.kind==='reconciled'));
});
