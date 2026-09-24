import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { guard,accountingGuard } from './execution.ts';
import { authorizeRunBudget } from '../cost/run-budget.ts';
import { Store } from './store.ts';
function fixture(spend:{blended:string;openai:string;typesafe:string},unknown=0,policy?:string,unlimited=false){
 const budget=authorizeRunBudget(unlimited?{mode:'unlimited',limits:{blended:null,openai:null,typesafe:null},unlimitedAcknowledged:true}:{mode:'limited',limits:{blended:null,openai:'100',typesafe:'200'},unlimitedAcknowledged:false},'person','2026-09-22');
 const env={MODEL_CALLS_ENABLED:'true',DB:{prepare:(sql:string)=>({first:async()=>sql.includes('controls')?{kill:0}:{count:unknown},bind(){return this;}})}} as unknown as Env;
 const store={run:async()=>({status:'running',budget_json:JSON.stringify(budget),pack_json:JSON.stringify({settings:policy?{unknownSpendPolicy:policy}:{}})}),spendByVendor:async()=>spend} as unknown as Store;
 return{env,store};
}
test('execution guard stops before another vendor call at a vendor-only limit',async()=>{
 const below=fixture({blended:'99',openai:'99',typesafe:'0'});await guard(below.env,below.store,'run');
 const reached=fixture({blended:'100',openai:'100',typesafe:'0'});await assert.rejects(()=>guard(reached.env,reached.store,'run'),{code:'E_LIVE_BUDGET'});
 const other=fixture({blended:'200',openai:'0',typesafe:'200'});await assert.rejects(()=>guard(other.env,other.store,'run'),{code:'E_LIVE_BUDGET'});
});
test('execution guard refuses unknown usage even below all limits',async()=>{
 const f=fixture({blended:'0',openai:'0',typesafe:'0'},1);await assert.rejects(()=>guard(f.env,f.store,'run'),{code:'E_SPEND_UNACCOUNTED'});
});

test('store groups persisted reader and recovery usage into OpenAI without SQL floating point',async()=>{
 const rows=[{role:'confidence',cost_nano:'9007199254740993'},{role:'reader',cost_nano:'100'},{role:'recovery',cost_nano:'50'}];
 const env={DB:{prepare:(sql:string)=>{assert.match(sql,/SELECT role,cost_nano/);return{bind:(runId:string)=>{assert.equal(runId,'run');return{all:async()=>({results:rows})};}}}}} as unknown as Env;
 const store=new Store(env);assert.deepEqual(await store.spendByVendor('run'),{blended:'9007199254741143',openai:'150',typesafe:'9007199254740993'});
});

test('accounting guard permits halted known Batch jobs including during closure but never unknown jobs',async()=>{
 for(const state of ['running','halted','closing','closed']){
  const env={DB:{prepare:()=>({bind:(batchId:string,runId:string)=>{assert.equal(batchId,'submitted');assert.equal(runId,'run');return{first:async()=>({remote_batch_id:'submitted'})};}})}} as unknown as Env;
  const store={run:async()=>({status:state})} as unknown as Store;await accountingGuard(env,store,'run','submitted');
 }
 const unknown={DB:{prepare:()=>({bind:()=>({first:async()=>null})})}} as unknown as Env;
 await assert.rejects(()=>accountingGuard(unknown,{run:async()=>({status:'halted'})} as unknown as Store,'run','unowned'),{code:'E_BATCH_ACCOUNTING_SCOPE'});
 await assert.rejects(()=>accountingGuard(unknown,{run:async()=>({status:'closed'})} as unknown as Store,'run','submitted'),{code:'E_BATCH_ACCOUNTING_SCOPE'});
});

test('pending accounting counts unfinished jobs and uncertain HTTP attempts without inventing costs',async()=>{
 const queries:string[]=[];const env={DB:{prepare:(sql:string)=>{queries.push(sql);return{bind:()=>({first:async()=>({count:sql.includes('batch_jobs')?2:1})})};}}} as unknown as Env;
 assert.equal(await new Store(env).pendingAccounting('run'),3);assert.match(queries[0],/batch_accounting/);assert.match(queries[1],/c.status!='complete'/);assert.match(queries[1],/NOT EXISTS.*vendor_calls/);
});

test('closure keeps uploaded R2 text when required Batch accounting cannot be prepared',async()=>{
 const writes:string[]=[];let deletes=0;
 const env={DB:{prepare:(sql:string)=>({bind(){return this;},first:async()=>null,all:async()=>({results:sql.startsWith('SELECT id,remote_batch_id')?[{id:'job',remote_batch_id:'submitted'}]:[]}),run:async()=>{writes.push(sql);return{meta:{changes:1}};}})},ARTIFACTS:{delete:async()=>{deletes++;}}} as unknown as Env;
 const store=new Store(env);store.run=async()=>({id:'run',status:'halted',pack_json:'{}'} as Awaited<ReturnType<Store['run']>>);store.event=async()=>{};
 await assert.rejects(()=>store.close('run','person'));
 assert.equal(deletes,0);assert.ok(!writes.some(sql=>sql.includes("status='closed'")));
});


test('real SQL guard stops unknown spend from failed or unanswered inference, not unrelated metadata',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE controls(id INTEGER,kill INTEGER); INSERT INTO controls VALUES(1,0); CREATE TABLE vendor_calls(run_id TEXT,role TEXT,status INTEGER,usage_json TEXT,cost_nano TEXT)');
  const f=fixture({blended:'0',openai:'0',typesafe:'0'});
  f.env.DB={prepare:(sql:string)=>{let params:SQLInputValue[]=[];return{bind(...values:SQLInputValue[]){params=values;return this;},first:async()=>db.prepare(sql).get(...params)??null};}} as unknown as D1Database;
  for(const status of [null,500,429,200]){
   db.exec('DELETE FROM vendor_calls');db.prepare('INSERT INTO vendor_calls VALUES(?,?,?,?,?)').run('run','reader',status,null,null);
   await assert.rejects(()=>guard(f.env,f.store,'run'),{code:'E_SPEND_UNACCOUNTED'});
  }
  db.exec('DELETE FROM vendor_calls');
  db.prepare('INSERT INTO vendor_calls VALUES(?,?,?,?,?)').run('run','batch_metadata',429,null,null);
  db.prepare('INSERT INTO vendor_calls VALUES(?,?,?,?,?)').run('another-run','reader',null,null,null);
  db.prepare('INSERT INTO vendor_calls VALUES(?,?,?,?,?)').run('run','reader',200,'{}','0');
  await guard(f.env,f.store,'run');
 }finally{db.close();}
});

test('new unlimited policy allows unrelated documents while legacy and capped runs retain unknown-spend stop',async()=>{
 const spend={blended:'0',openai:'0',typesafe:'0'};
 const allowed=fixture(spend,1,'isolate-unlimited-v1',true);await guard(allowed.env,allowed.store,'run');
 const legacy=fixture(spend,1,undefined,true);await assert.rejects(()=>guard(legacy.env,legacy.store,'run'),{code:'E_SPEND_UNACCOUNTED'});
 const capped=fixture(spend,1,'isolate-unlimited-v1');await assert.rejects(()=>guard(capped.env,capped.store,'run'),{code:'E_SPEND_UNACCOUNTED'});
});
test('unlimited isolation never bypasses the model gate or revives a halted run',async()=>{
 const f=fixture({blended:'0',openai:'0',typesafe:'0'},1,'isolate-unlimited-v1',true);
 f.env.MODEL_CALLS_ENABLED='false';await assert.rejects(()=>guard(f.env,f.store,'run'),{code:'E_MODEL_CALLS_DISABLED'});
 f.env.MODEL_CALLS_ENABLED='true';const original=f.store.run;f.store.run=async id=>({...await original(id),status:'halted'});
 await assert.rejects(()=>guard(f.env,f.store,'run'),{code:'E_RUN_STOPPED'});
});

test('new spend policy preserves kill-switch priority and reached-cap admission',async()=>{
 const f=fixture({blended:'0',openai:'0',typesafe:'0'},1,'isolate-unlimited-v1',true);
 f.env.DB={prepare:()=>({first:async()=>({kill:1})})} as unknown as D1Database;
 await assert.rejects(()=>guard(f.env,f.store,'run'),{code:'E_KILL_SWITCH'});
 const capped=fixture({blended:'100',openai:'100',typesafe:'0'},0,'isolate-unlimited-v1');
 await assert.rejects(()=>guard(capped.env,capped.store,'run'),{code:'E_LIVE_BUDGET'});
});
