import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
const base=process.env.UI_TEST_URL??'http://127.0.0.1:5173';
const pack=JSON.parse(await fs.readFile('projects/generic/project.json','utf8'));
const zip=new ZipWriter(new BlobWriter());
await zip.add('word/document.xml',new TextReader('<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>A complete synthetic source document for local extraction verification.</w:t></w:r></w:p></w:body></w:document>'));
const bytes=Array.from(new Uint8Array(await(await zip.close()).arrayBuffer()));
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const context=await browser.newContext(); const page=await context.newPage();const calls=[];
 await context.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;calls.push({path,method:route.request().method()});if(path==='/api/health')return route.fulfill({json:{status:'READY',blockers:[],versions:{},project:{productName:'Document workspace'},modelCallsEnabled:true,textHeldRuns:0}});if(path==='/api/project')return route.fulfill({json:pack});return route.fulfill({status:404,json:{error:{code:'E_TEST_UNEXPECTED',headline:path}}});});
 await page.goto(base+'/#home'); await page.getByRole('button',{name:'Choose source folder',exact:true}).waitFor();
 const moduleUrl='/@fs/'+process.cwd().replaceAll('\\','/')+'/core/local/state.ts';
 await page.evaluate(async({bytes,moduleUrl})=>{const root=await navigator.storage.getDirectory();const folder=await root.getDirectoryHandle('synthetic-source',{create:true});const file=await folder.getFileHandle('source.docx',{create:true});const writer=await file.createWritable();await writer.write(new Uint8Array(bytes));await writer.close();const output=await folder.getDirectoryHandle('output',{create:true});const category=await output.getDirectoryHandle('category',{create:true});const copy=await category.getFileHandle('tag--source.docx',{create:true});const copied=await copy.createWritable();await copied.write(new Uint8Array(bytes));await copied.close();const marker=await output.getFileHandle('build-summary-12345678-1234-4234-8234-123456789abc.md',{create:true});const summary=await marker.createWritable();await summary.write('# Local build summary\n\nRun: 12345678-1234-4234-8234-123456789abc\n\nComplete');await summary.close();window.showDirectoryPicker=async()=>folder;const {LocalRunStore}=await import(moduleUrl);const store=await LocalRunStore.open();for(const [sourcePath,state]of [['output/old-category/old.docx','uploaded'],['moved.docx','extracted']])await store.put({runId:'stale',sourcePath,fingerprint:'a'.repeat(64),state,document:{fingerprint:'a'.repeat(64),originalFilename:sourcePath,fullText:'old',outline:{headings:[],tables:[],blocks:[]}}});store.close();localStorage.setItem('local-extraction-run','stale');sessionStorage.setItem('local-extraction-run','stale');localStorage.setItem('workspace-reference','owner-reference');sessionStorage.setItem('workspace-reference','owner-reference');}, {bytes,moduleUrl});
 await page.reload();
 await page.getByRole('button',{name:'Choose source folder',exact:true}).waitFor();
 const freshId=await page.evaluate(()=>sessionStorage.getItem('local-extraction-run'));
 assert.ok(freshId&&freshId!=='stale','New comparison must not reuse stale local extraction');
 const other=await context.newPage();await other.goto(base+'/#health');
 await other.evaluate(()=>localStorage.setItem('local-extraction-run','stale'));
 await page.evaluate(async()=>{const root=await navigator.storage.getDirectory();const folder=await root.getDirectoryHandle('synthetic-source');window.showDirectoryPicker=async()=>folder;});
 await page.getByRole('button',{name:'Choose source folder',exact:true}).click();
 await page.getByRole('button',{name:'Exclude output copies and use the originals',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Use this folder for a new extraction',exact:true}).count(),0);
 await page.getByRole('button',{name:'Exclude output copies and use the originals',exact:true}).click();
 let extracted=false;
 for(let attempt=0;attempt<100;attempt++){
  extracted=await page.evaluate(async moduleUrl=>{const {LocalRunStore}=await import(moduleUrl);const store=await LocalRunStore.open();try{return(await store.list(sessionStorage.getItem('local-extraction-run'))).some(x=>x.sourcePath==='source.docx'&&x.state==='extracted');}finally{store.close();}},moduleUrl);
  if(extracted)break;await page.waitForTimeout(100);
 }
 assert.equal(extracted,true,'Real local worker extraction must finish');
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('local-extraction-run')),freshId,'Another tab must not replace active extraction');
 assert.equal(await page.getByText('Documents from this local run are missing from the selected folder.',{exact:false}).count(),0);
 const result=await page.evaluate(async moduleUrl=>{const {LocalRunStore}=await import(moduleUrl);const store=await LocalRunStore.open();try{const id=sessionStorage.getItem('local-extraction-run')??localStorage.getItem('local-extraction-run');return{fresh:await store.list(id),stale:await store.list('stale'),reference:localStorage.getItem('workspace-reference')};}finally{store.close();}},moduleUrl);
 assert.equal(result.fresh.length,1);assert.equal(result.fresh[0].document.fullText,'[Page 1]\nA complete synthetic source document for local extraction verification.');assert.equal(result.stale.length,2);assert.equal(result.reference,'owner-reference');assert.equal(calls.filter(x=>x.method!=='GET').length,0);
 await page.evaluate(async moduleUrl=>{const {LocalRunStore}=await import(moduleUrl);const store=await LocalRunStore.open();try{await store.put({runId:sessionStorage.getItem('local-extraction-run'),sourcePath:'removed.docx',fingerprint:'b'.repeat(64),state:'not started'});}finally{store.close();}},moduleUrl);
 await page.getByRole('button',{name:'Choose source folder',exact:true}).click();
 await page.getByRole('button',{name:'Exclude output copies and use the originals',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Use this folder for a new extraction',exact:true}).count(),0);
 await page.getByRole('button',{name:'Exclude output copies and use the originals',exact:true}).click();
 await page.getByRole('button',{name:'Use this folder for a new extraction',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('local-extraction-run')),freshId,'True resume mismatch must await explicit restart');
 await page.getByRole('button',{name:'Use this folder for a new extraction',exact:true}).click();
 let restarted=false;
 for(let attempt=0;attempt<100;attempt++){
  restarted=await page.evaluate(async({moduleUrl,freshId})=>{const id=sessionStorage.getItem('local-extraction-run');if(id===freshId)return false;const {LocalRunStore}=await import(moduleUrl);const store=await LocalRunStore.open();try{return(await store.list(id)).some(x=>x.sourcePath==='source.docx'&&x.state==='extracted')&&localStorage.getItem('local-reference:'+id)==='owner-reference'&&(await store.list(freshId)).length===2;}finally{store.close();}},{moduleUrl,freshId});
  if(restarted)break;await page.waitForTimeout(100);
 }
 assert.equal(restarted,true,'Explicit restart must extract retained handle, preserve previous records and carry comparison');
 const intact=await page.evaluate(async bytes=>{const root=await navigator.storage.getDirectory();const source=await root.getDirectoryHandle('synthetic-source');const output=await source.getDirectoryHandle('output');const category=await output.getDirectoryHandle('category');const copied=await(await category.getFileHandle('tag--source.docx')).getFile();return JSON.stringify(Array.from(new Uint8Array(await copied.arrayBuffer())))===JSON.stringify(bytes)&&(await(await output.getFileHandle('build-summary-12345678-1234-4234-8234-123456789abc.md')).getFile()).size>0;},bytes);
 assert.equal(intact,true,'Excluded generated tree must remain byte-intact');
 assert.equal(calls.filter(x=>x.method!=='GET').length,0);
 console.log('Source-picker regression: new comparison isolates stale moved paths and another tab; fresh extraction reads and hashes a real local DOCX through workers; old records and reference preserved; genuine missing-file resume requires explicit restart and reuses selected handle; nested output requires explicit exclusion and stays intact; zero API writes/model calls.');
} finally {await browser.close();}
