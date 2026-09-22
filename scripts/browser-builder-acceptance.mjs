import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {diffCorrection} from '../core/correction/diff.ts';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();const posts=[],external=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5173')&&!r.url().startsWith('blob:'))external.push(r.url());});
 await page.route('**/api/**',route=>{if(route.request().method()==='POST'){posts.push(JSON.parse(route.request().postData()));return route.fulfill({status:409,json:{error:'Local acceptance captures listing without persistence'}});}return route.fulfill({json:{status:'NOT READY',blockers:[],versions:{},project:{},modelCallsEnabled:false,textHeldRuns:0}});});
 await page.goto('http://127.0.0.1:5173/#build');
 const result=await page.evaluate(async moduleRoot=>{
  const {buildTree,planTree,sha256}=await import(moduleRoot+'/core/builder/builder.ts');const {browserDestination,scanSourceFolder}=await import(moduleRoot+'/core/builder/browser.ts');
  const root=await navigator.storage.getDirectory(),fixture=await root.getDirectoryHandle('acceptance-'+crypto.randomUUID(),{create:true});
  const sources=await fixture.getDirectoryHandle('source',{create:true}),out=await fixture.getDirectoryHandle('destination',{create:true}),conflict=await fixture.getDirectoryHandle('conflict',{create:true});
  async function write(directory,name,text){const handle=await directory.getFileHandle(name,{create:true});const w=await handle.createWritable();await w.write(text);await w.close();return handle;}
  const bytes1=new TextEncoder().encode('original one'),bytes2=new TextEncoder().encode('original two');await write(sources,'renamed-source.bin','original one');await write(sources,'second.bin','original two');
  const entries=[{fingerprint:await sha256(bytes1),originalFilename:'first.bin',tag:'r1-0001',destinationFolder:'type_a',rule:'R1',reasoningNote:'Both agreed.'},{fingerprint:await sha256(bytes2),originalFilename:'second.bin',tag:'r1-0002',destinationFolder:'human_review',rule:'R5',reasoningNote:'Review needed.'}];
  for(const entry of entries){entry.confidenceCheck=null;entry.reader=null;}const manifest={runId:'browser-opfs-run',entries};const plan=planTree(manifest,{naming:'original',destinationPrefix:'C:/acceptance',maxPathLength:260,maxComponentLength:255});
  const scan=await scanSourceFolder(sources),destination=browserDestination(out,navigator.locks);
  const first=await buildTree(plan,scan,destination);if(!first.complete)throw new Error(JSON.stringify(first));const resume=await buildTree(plan,scan,destination);
  const review=await out.getDirectoryHandle('human_review'),sidecar=await(await(await review.getFileHandle('r1-0002--second.bin.md')).getFile()).text();
  const conflictType=await conflict.getDirectoryHandle('type_a',{create:true});await write(conflictType,'r1-0001--first.bin','keep this conflict');const conflicted=await buildTree(plan,scan,browserDestination(conflict,navigator.locks));
  const conflictBytes=await(await(await conflictType.getFileHandle('r1-0001--first.bin')).getFile()).text();
  const missingManifest={runId:'missing-run',entries:[{...entries[0],fingerprint:'0'.repeat(64),tag:'r1-0003'}]},missing=await buildTree(planTree(missingManifest,{naming:'original',destinationPrefix:'C:/acceptance',maxPathLength:260,maxComponentLength:255}),scan,destination);
  const typeB=await out.getDirectoryHandle('type_b',{create:true}),typeA=await out.getDirectoryHandle('type_a');
  const moved=await typeA.getFileHandle('r1-0001--first.bin');if(typeof moved.move!=='function')throw new Error('OPFS native move unavailable; no simulated substitute used.');await moved.move(typeB,'r1-0001--first.bin');
  const renamed=await review.getFileHandle('r1-0002--second.bin');await renamed.move(typeB,'renamed-review.bin');
  window.showDirectoryPicker=async()=>out;
  const summaries=[];for await(const f of out.values())if(f.kind==='file'&&f.name.startsWith('build-summary-'))summaries.push(f.name);
  return{manifest,first,resume,conflicted,conflictBytes,missing,sidecar,summaries,sourceHashes:(await scanSourceFolder(sources)).map(s=>s.fingerprint).sort(),originalHashes:entries.map(e=>e.fingerprint).sort(),nativeMove:true,userAgent:navigator.userAgent};
 },'/@fs/'+process.cwd().replaceAll('\\','/'));
 let checks=0;const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
 check(result.first.entries.map(e=>e.status),['copied','copied']);check(result.first.complete,true);check(result.resume.entries.map(e=>e.status),['already_present','already_present']);check(result.resume.complete,true);check(result.conflicted.entries[0].status,'destination_conflict');check(result.conflictBytes,'keep this conflict');check(result.missing.entries[0].status,'not_found');check(result.sourceHashes,result.originalHashes);check(new Set(result.summaries).size,3);check(result.sidecar.includes('R5'),true);
 await page.getByRole('link',{name:'Corrections',exact:true}).click();const choice=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose manifest JSON'}).click();await(await choice).setFiles({name:'manifest.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(result.manifest))});
 await page.getByRole('button',{name:'Choose corrected tree'}).click();await page.getByText('Files in corrected tree: 2',{exact:true}).waitFor();await page.getByRole('checkbox',{name:'type_b',exact:true}).check();await page.getByRole('button',{name:'Review corrections',exact:true}).click();await page.waitForTimeout(100);
 check(posts.length,1);const listing=posts[0];check(listing.files.length,2);check(listing.sidecarPaths.length,4);check(listing.files.some(f=>f.filename==='renamed-review.bin'&&f.fingerprint===result.manifest.entries[1].fingerprint),true);
 const diff=diffCorrection({manifest:result.manifest.entries,...listing,typeFolders:['type_a','type_b']});check(diff.moves.map(m=>m.kind).sort(),['human_label','misfile']);check(diff.moves.map(m=>m.matchedBy).sort(),['fingerprint','tag']);check(diff.deleted.length,0);check(diff.unmatched.length,0);check(external,[]);
 fs.mkdirSync('.local/qa',{recursive:true});const evidence={at:new Date().toISOString(),checks,userAgent:result.userAgent,filesystem:'Actual Chromium OPFS FileSystemDirectoryHandle/FileSystemFileHandle, createWritable, Web Locks and native move',picker:'Native picker not exercised; injected picker returns real OPFS handle',network:'One intercepted correction listing only; no remote calls, originals or text uploaded',build:result.first.entries.map(e=>e.status),resume:result.resume.entries.map(e=>e.status),conflict:result.conflicted.entries[0].status,missing:result.missing.entries[0].status,diff:diff.moves.map(m=>({kind:m.kind,matchedBy:m.matchedBy})),limitations:['Native user-visible filesystem permissions/dialog and desktop external-process race are not covered.','Correction API persistence and threshold application not exercised; listing passed to real pure diff locally.']};
 fs.writeFileSync('.local/qa/builder-opfs-'+Date.now()+'.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{await browser.close();}
