import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Store} from '../core/server/store.ts';
import {recoverRun,dispatchRecovery,recoveryProgress} from '../core/server/run-recovery.ts';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("local");}}',compatibilityDate:'2026-09-22',d1Databases:['DB'],r2Buckets:['ARTIFACTS'],outboundService:()=>{throw Error('No network permitted');}}));
let checks=0;const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
try{
 const DB=await mf.getD1Database('DB'),ARTIFACTS=await mf.getR2Bucket('ARTIFACTS');
 for(const name of(await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort())await DB.exec(await readFile('migrations/'+name,'utf8'));
 await DB.prepare("INSERT INTO quotes VALUES('q','owner','then','interactive','types','hash','{}','{}')").run();
 await DB.prepare("INSERT INTO runs(id,actor,status,created_at,mode,expected_count,threshold,threshold_justification,type_version,pack_json,budget_json,quote_id,halt_json) VALUES('run','owner','halted','then','interactive',114,.9,'original','types','frozen','budget','q',?)").bind(JSON.stringify({code:'E_WORKFLOW_INTERRUPTED'})).run();
 const states=new Map(),created=[];
 for(let i=0;i<114;i++){const fingerprint='doc-'+i;await DB.prepare("INSERT INTO documents(run_id,fingerprint,tag,original_filename,status,input_key,input_hash,workflow_id) VALUES('run',?,?,'original',?,?,'hash',?)").bind(fingerprint,fingerprint,i===0?'complete':'running','input-'+i,'old-'+i).run();states.set('old-'+i,i===0?'complete':'errored');await ARTIFACTS.put('input-'+i,'retained synthetic input');}
 const store=new Store({DB,ARTIFACTS,DOCUMENT_WORKFLOW:{async get(id){return{async status(){if(!states.has(id))throw Error('Unknown ID');return{status:states.get(id)};}};},async create({id,params}){created.push({id,params});states.set(id,'queued');if(created.length===1)throw Error('Synthetic lost acknowledgement');}}});
 const options={acknowledged:true,assertReady:async()=>{}};
 const first=await recoverRun(store,'run','owner',options);check(first.started,50);check(first.pending,63);
 const second=await dispatchRecovery(store,'run','owner',options);check(second.started,50);check(second.pending,13);
 const third=await dispatchRecovery(store,'run','owner',options);check(third.started,13);check(third.pending,0);check(created.length,113);check(new Set(created.map(item=>item.id)).size,113);check(created.every(item=>typeof item.params.recoveryId==='string'),true);
 const progress=await recoveryProgress(store,'run','owner');check(progress.total,113);check(progress.pending,0);
 check((await DB.prepare("SELECT workflow_id FROM documents WHERE fingerprint='doc-0'").first()).workflow_id,'old-0');check((await DB.prepare('SELECT pack_json,budget_json FROM runs').first()),{pack_json:'frozen',budget_json:'budget'});
 await assert.rejects(()=>DB.prepare("UPDATE run_recoveries SET actor='other'").run());checks++;
 await assert.rejects(()=>DB.prepare("UPDATE run_recovery_documents SET new_workflow_id='replacement'").run());checks++;
 await assert.rejects(()=>dispatchRecovery(store,'run','other',options));checks++;check(created.length,113);
 console.log(`Recovery actual D1/R2 acceptance: ${checks} assertions passed; 114 synthetic documents, mocked Workflow control, zero vendor calls.`);
}finally{await mf.dispose();}
