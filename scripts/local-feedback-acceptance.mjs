import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
// Local-only credentials satisfy setup checks. No workflow or vendor request may execute.
const compiled=await build({stdin:{contents:"import {handleWithCloudflareIdentity} from './core/server/api.ts';export default {fetch(r,e){return handleWithCloudflareIdentity(r,{...e,OPENAI_API_KEY:{get:async()=> 'local-test-only'},JEV_API_KEY:{get:async()=> 'local-test-only'},DOCUMENT_WORKFLOW:{create(){throw Error('Inference forbidden in feedback acceptance')}}},r.headers.get('X-Test-Actor')||'editor');}}",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',alias:{'project-pack':path.resolve('projects/validation/project.json')}});
let checks=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-22',d1Databases:['DB'],r2Buckets:['ARTIFACTS'],bindings:{DEFINITION_MODE:'runtime',DEFINITION_EDITORS:'["editor"]',PROJECT_ID:'validation',BUILD_COMMIT:'feedback-local-test',MODEL_CALLS_ENABLED:'true'},outboundService:()=>{throw Error('No remote calls permitted');}}));
try{
 const db=await mf.getD1Database('DB'),r2=await mf.getR2Bucket('ARTIFACTS');for(const name of(await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile('migrations/'+name,'utf8'));
 const call=async(url,body,actor='editor')=>{const r=await mf.dispatchFetch('http://localhost/api/'+url,{method:body?'POST':'GET',headers:{'content-type':'application/json','X-Test-Actor':actor},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};};
 const seed=(await call('definitions')).body.seedTypeFile;const a=seed.types[0].id,b=seed.types[1].id;
 const typeFile=structuredClone(seed);typeFile.types.push({id:'additional_category',name:'Additional category',what:'Primarily presents explanatory material.',not_for:'Documents primarily requesting completed answers.',examples:['An educational overview explaining a topic.']});
 const draft=await call('definitions/drafts',{baseRevisionId:null,typeFile,displayNames:{}});check(draft.status,201);check((await call('definitions/'+draft.body.id+'/activate',{inheritThreshold:false})).status,200);
 const pack=(await call('project')).body;const sourcePack={...pack,typeFile:seed};delete sourcePack.definitionRevisionId;
 await db.prepare("INSERT INTO quotes VALUES('old-quote','editor','2026-09-24','interactive','old','old','[]','{}')").run();
 await db.prepare("INSERT INTO runs(id,actor,status,created_at,mode,expected_count,threshold,threshold_justification,type_version,pack_json,budget_json,quote_id,text_held) VALUES('source','editor','closed','2026-09-24','interactive',7,.9,'initial','old',?,'{}','old-quote',0)").bind(JSON.stringify(sourcePack)).run();
 const hash=n=>String(n).padStart(64,'0');
 const entries=Array.from({length:7},(_,i)=>({fingerprint:hash(i+1),tag:'source-'+i,originalFilename:'document-'+i+'.pdf',destinationFolder:i<2?a:i===6?'could_not_process':'human_review',rule:i<2?'R1':i===6?'R0':'R4'}));
 for(const e of entries)await db.prepare("INSERT INTO documents(run_id,fingerprint,tag,original_filename,status,input_hash,decision_json) VALUES('source',?,?,?,'complete','fixture',?)").bind(e.fingerprint,e.tag,e.originalFilename,JSON.stringify({destinationFolder:e.destinationFolder,ruleId:e.rule})).run();
 const match=(i,folder)=>({entry:entries[i],file:{folder,filename:entries[i].tag+'--'+entries[i].originalFilename},matchedBy:'tag'});
 const moves=[match(2,'New folder'),match(3,b),match(4,'Ignored folder')].map(m=>({...m,from:m.entry.destinationFolder,to:m.file.folder,kind:'unresolved_folder'}));
 const diff={confirmations:[match(0,a),match(1,a)],moves,unchecked:[match(5,'human_review'),match(6,'could_not_process')],deleted:[],unmatched:[],ignored:[],unknownFolders:[]};
 const proposals={ignoredFolders:['Ignored folder']};
 for(const key of ['input','result'])await db.prepare("INSERT INTO artifacts(key,run_id,kind,state,contains_text,created_at) VALUES(?,'source','correction','complete',0,'2026-09-24')").bind(key).run();
 await r2.put('result',JSON.stringify({diff,proposals,proposalContext:{}}));
 await db.prepare("INSERT INTO corrections VALUES('correction','source','editor','2026-09-24','input','result',?)").bind(JSON.stringify(proposals)).run();
 const listing=await call('runs/source/corrections');check(listing.status,200);check(listing.body,{corrections:[{id:'correction',createdAt:'2026-09-24'}]});check((await call('runs/source/corrections',null,'other')).status,403);
 const saved=await call('runs/source/corrections/correction');check(saved.status,200);check(saved.body.referenceCandidates.length,7);check(saved.body.referenceCandidates[2].status,'unconfirmed');
 const refInput={definitionRevisionId:draft.body.id,labels:[{fingerprint:hash(2),status:'ambiguous',labels:[a,b]}],folderLabels:{'New folder':'additional_category'}};
 check((await call('runs/source/corrections/correction/reference',{...refInput,folderLabels:{'New folder':'unknown'}})).status,400);
 check((await call('runs/source/corrections/correction/reference',{...refInput,definitionRevisionId:'unknown'})).status,400);
 const ref=await call('runs/source/corrections/correction/reference',refInput);check(ref.status,201);check(ref.body.entries[2].labels,['additional_category']);check(ref.body.entries[4].status,'excluded');check(ref.body.entries[5].status,'unconfirmed');check(ref.body.entries[6].status,'failure');
 check((await call('feedback/'+ref.body.id,null,'other')).status,400);
 const again=await call('runs/source/corrections/correction/reference',refInput);check(again.status,201);assert.notEqual(ref.body.id,again.body.id);checks++;
 const docs=[1,2,3,4,8].map(n=>({fingerprint:hash(n),originalFilename:'renamed-'+n+'.pdf',tokenCounts:{readerInputTokens:null,confidenceInputTokens:null,recoveryInputTokens:null},needsOutlineRecovery:false,failed:false}));
 const quote=await call('quote',{mode:'interactive',documents:docs,referenceId:ref.body.id});check(quote.status,200);
 const run=await call('runs',{quoteId:quote.body.quoteId,budget:{mode:'limited',limits:{blended:'1000000',openai:null,typesafe:null},unlimitedAcknowledged:false}});check(run.status,201);
 check((await db.prepare('SELECT reference_id FROM feedback_run_links WHERE run_id=?').bind(run.body.runId).first()).reference_id,ref.body.id);
 for(const [i,doc]of docs.entries()){const folder=i===2?'additional_category':i===3?'could_not_process':a;await db.prepare("INSERT INTO documents(run_id,fingerprint,tag,original_filename,status,input_hash,decision_json) VALUES(?,?,?,?,'complete','fixture',?)").bind(run.body.runId,doc.fingerprint,'different-tag-'+i,doc.originalFilename,JSON.stringify({destinationFolder:folder,ruleId:i===3?'R0':'R1'})).run();}
 await db.prepare("UPDATE runs SET status='complete' WHERE id=?").bind(run.body.runId).run();
 const result=await call('runs/'+run.body.runId+'/comparison');check(result.status,200);check(result.body.sourceRunId,'source');check(result.body.complete,true);check(result.body.moved.total,3);check(result.body.moved.comparable,1);check(result.body.moved.matched,1);check(result.body.moved.failures,1);check(result.body.moved.excluded,1);check(result.body.previouslyFiled.total,2);check(result.body.previouslyFiled.comparable,1);check(result.body.previouslyFiled.same,1);check(result.body.previouslyFiled.ambiguous,1);check(result.body.missing,3);check(result.body.newDocuments,1);
 check((await db.prepare('SELECT COUNT(*) AS n FROM vendor_calls').first()).n,0);
 await assert.rejects(()=>db.prepare('UPDATE feedback_references SET labels_json=? WHERE id=?').bind('[]',ref.body.id).run());checks++;
 await assert.rejects(()=>db.prepare('UPDATE feedback_run_links SET reference_id=? WHERE run_id=?').bind(again.body.id,run.body.runId).run());checks++;
 const changed=structuredClone(typeFile);changed.types[0].examples.push('A second explanation example.');const newer=await call('definitions/drafts',{baseRevisionId:draft.body.id,typeFile:changed,displayNames:{}});check(newer.status,201);check((await call('definitions/'+newer.body.id+'/activate',{inheritThreshold:false})).status,200);check((await call('quote',{mode:'interactive',documents:docs,referenceId:ref.body.id})).status,400);
 console.log(`Feedback D1 API acceptance: ${checks} checks passed; zero vendor calls.`);
}finally{await mf.dispose();}
