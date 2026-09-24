import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {Store} from './store.ts';
import {checkpoint} from './checkpoint.ts';
import {assertWorkflowGeneration} from './workflow-generation.ts';
function setup(){
 const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE runs(id TEXT,status TEXT,halt_json TEXT); INSERT INTO runs VALUES('run','running',NULL);
 CREATE TABLE run_recoveries(id TEXT,run_id TEXT,generation INTEGER);
 CREATE TABLE events(id TEXT,run_id TEXT,fingerprint TEXT,created_at TEXT,stage TEXT,kind TEXT,elapsed_ms INTEGER,details_json TEXT);`);
 const env={DB:{prepare:(sql:string)=>{let args:SQLInputValue[]=[];return{bind(...values:SQLInputValue[]){args=values;return this;},async first(){return db.prepare(sql).get(...args)??null;},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};}}} as unknown as Env;
 return{db,store:new Store(env)};
}
test('original and current generation accepted; obsolete generations cannot reach paid action',async()=>{
 const f=setup();try{await assertWorkflowGeneration(f.store,'run');f.db.exec("INSERT INTO run_recoveries VALUES('new','run',1)");let paid=0;
 for(const id of [undefined,'old'])await assert.rejects(async()=>{await assertWorkflowGeneration(f.store,'run',id);paid++;},{code:'E_WORKFLOW_SUPERSEDED'});
 await assertWorkflowGeneration(f.store,'run','new');assert.equal(paid,0);
 }finally{f.db.close();}
});
test('halt CAS excludes old generations and retains first current-generation cause',async()=>{
 const f=setup();try{f.db.exec("INSERT INTO run_recoveries VALUES('new','run',2)");
 await f.store.halt('run',{code:'late-original'},null);await f.store.halt('run',{code:'late-recovery'},'old');assert.equal(f.db.prepare('SELECT status FROM runs').get()!.status,'running');
 await f.store.halt('run',{code:'first'},'new');await f.store.halt('run',{code:'second'},'new');assert.equal(f.db.prepare('SELECT halt_json FROM runs').get()!.halt_json,JSON.stringify({code:'first'}));
 }finally{f.db.close();}
});
test('original generation can halt only before a recovery plan exists',async()=>{const f=setup();try{await f.store.halt('run',{code:'original'},null);assert.equal(f.db.prepare('SELECT status FROM runs').get()!.status,'halted');}finally{f.db.close();}});
test('current generation can reuse completed old checkpoint without repeating work',async()=>{const f=setup();try{f.db.exec("INSERT INTO run_recoveries VALUES('new','run',1)");let work=0;const key=await checkpoint({claim:async()=>({state:'complete',key:'old-paid-result'}),finish:async()=>{},fail:async()=>{}},()=>assertWorkflowGeneration(f.store,'run','new'),'confidence-http-1',async()=>{work++;return 'wrong';});assert.equal(key,'old-paid-result');assert.equal(work,0);}finally{f.db.close();}});
