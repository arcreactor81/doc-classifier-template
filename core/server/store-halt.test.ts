import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from './store.ts';

function fixture(status:string,halt:unknown=null){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE runs(id TEXT PRIMARY KEY,status TEXT,halt_json TEXT,pack_json TEXT,created_at TEXT,closed_at TEXT,manifest_key TEXT);
 CREATE TABLE events(id TEXT PRIMARY KEY,run_id TEXT,fingerprint TEXT,created_at TEXT,stage TEXT,kind TEXT,elapsed_ms INTEGER,details_json TEXT);
 CREATE TABLE run_updates(id TEXT);
 CREATE TRIGGER observe_run_update AFTER UPDATE ON runs BEGIN INSERT INTO run_updates VALUES(new.id); END;`);
 db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)').run('current',status,halt===null?null:JSON.stringify(halt),'frozen-pack','original-created',status==='closed'?'original-closed':null,'retained-manifest');
 db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)').run('historical','halted',JSON.stringify({code:'historical-cause'}),'historical-pack','historical-created',null,'historical-manifest');
 db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)').run('historical-event','historical',null,'historical-created','run','halted',null,JSON.stringify({code:'historical-cause'}));
 const env={DB:{prepare:(sql:string)=>{let values:SQLInputValue[]=[];return{
  bind(...input:SQLInputValue[]){values=input;return this;},
  run:async()=>{const result=db.prepare(sql).run(...values);return{meta:{changes:Number(result.changes)}};},
 };}}} as unknown as Env;
 return{db,store:new Store(env),row:()=>db.prepare('SELECT * FROM runs WHERE id=?').get('current'),events:()=>db.prepare('SELECT * FROM events WHERE run_id=? ORDER BY rowid').all('current')};
}

test('halt retains the first cause when concurrent workflow stops arrive and keeps every observation',async()=>{
 for(const state of ['uploading','running']){
  const f=fixture(state);
  try{
   const before=f.row()!,history=f.db.prepare('SELECT * FROM runs WHERE id=?').get('historical'),oldEvents=f.db.prepare('SELECT * FROM events WHERE run_id=?').all('historical');
   const cause={code:'E_SPEND_UNACCOUNTED',message:'Recorded vendor spending is unavailable.'};
   const late=[{code:'E_RUN_STOPPED',message:'This run is not running.'},{code:'E_STORAGE_D1',message:'A later storage failure.'}];
   await Promise.all([f.store.halt('current',cause),...late.map(issue=>f.store.halt('current',issue))]);
   assert.deepEqual({...f.row()},{...before,status:'halted',halt_json:JSON.stringify(cause)});
   assert.deepEqual(f.events().map(row=>({kind:row.kind,details:JSON.parse(String(row.details_json))})),[
    {kind:'halted',details:cause},...late.map(details=>({kind:'halt_observed',details})),
   ]);
   assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM run_updates').get()!.count,1);
   assert.deepEqual(f.db.prepare('SELECT * FROM runs WHERE id=?').get('historical'),history);
   assert.deepEqual(f.db.prepare('SELECT * FROM events WHERE run_id=?').all('historical'),oldEvents);
  }finally{f.db.close();}
 }
});

test('late halts cannot rewrite stopped or completed run metadata but remain in the event history',async()=>{
 for(const state of ['halted','complete','closing','closed']){
  const f=fixture(state,{code:'retained-cause'});
  try{
   const before=f.row(),details={code:'E_RUN_STOPPED',message:'A concurrent workflow observed the stopped run.'};
   await f.store.halt('current',details);
   assert.deepEqual(f.row(),before,state);
   assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM run_updates').get()!.count,0,state);
   assert.deepEqual(f.events().map(row=>({kind:row.kind,details:JSON.parse(String(row.details_json))})),[{kind:'halt_observed',details}]);
  }finally{f.db.close();}
 }
});
