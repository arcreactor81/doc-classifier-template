import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const pack=JSON.parse(await fs.readFile('projects/generic/project.json','utf8'));
pack.typeFile.types=[{id:'type_a',name:'A',what:'B',not_for:'C',examples:['D']}];
pack.tokenizers={confidence:{id:'test_request_codec',verifiedAt:'2026-09-22',source:'test'}};
pack.limits.readerBatchEnqueuedTokens=null;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
const page=await browser.newPage();const posts=[];let changePack=false;
page.on('request',r=>{if(r.method()==='POST')posts.push({url:r.url(),body:r.postDataJSON()});});
// Test-only codec served by an isolated browser route; never registered in the app.
await page.route('**/core/local/tokenizers.ts*',r=>r.fulfill({contentType:'application/javascript',body:`export function codecFor(id){return {id,countTokens:text=>text.length,prefixWithinBudget:(text,fits)=>{let prefix='';for(const char of text){if(!fits(prefix+char))break;prefix+=char;}return prefix;}};}`}));
await page.route('**/api/health',r=>r.fulfill({json:{status:'NOT READY',blockers:[],versions:{},project:{},modelCallsEnabled:false,textHeldRuns:0}}));
await page.route('**/api/project',r=>r.fulfill({json:changePack?{...pack,productName:'Changed workspace'}:pack}));
await page.route('**/api/quote',async r=>r.fulfill({json:{quoteId:'test_quote',typeVersion:await page.evaluate(()=>window.testTypeVersion),mode:'interactive'}}));
await page.route('**/api/runs',r=>r.fulfill({json:{runId:'created'}}));
await page.route('**/api/runs/created',r=>r.fulfill({json:{run:{status:'complete'}}}));
async function setup(){
 await page.goto('http://127.0.0.1:5173/#help');
 await page.evaluate(async ({pack,base})=>{
  const {LocalRunStore}=await import(base+'/core/local/state.ts');const {attachRunPreflight}=await import(base+'/ui/app/preflight.ts');const {typeVersion}=await import(base+'/core/config/project.ts');
  const runId=crypto.randomUUID();localStorage.setItem('local-extraction-run',runId);const extracted={fingerprint:'a'.repeat(64),originalFilename:'one.docx',fullText:'GH',outline:{headings:[],tables:[],blocks:[{position:0,text:'GH'}]},extractorVersion:'1',parserVersions:{zip:'1',xml:'1',pdf:'1'},needsOutlineRecovery:false};const store=await LocalRunStore.open();await store.put({runId,sourcePath:'one.docx',fingerprint:extracted.fingerprint,state:'extracted',document:extracted});store.close();window.testTypeVersion=await typeVersion(JSON.stringify(pack.typeFile));window.testErrors=[];window.started=false;
  document.querySelector('#budget-harness')?.remove();const host=document.createElement('section');host.id='budget-harness';const mode=document.createElement('select');const option=document.createElement('option');option.value='interactive';mode.append(option);host.append(mode);document.body.append(host);
  attachRunPreflight(host,mode,{ready:true,request:async(path,body)=>{const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json();},onError:e=>window.testErrors.push(e.message),onRun:()=>{window.started=true;}});
 },{pack,base:'/@fs/'+process.cwd().replaceAll('\\','/')});
 const host=page.locator('#budget-harness');await host.getByRole('button',{name:'Review run',exact:true}).click();await page.waitForFunction(()=>window.testErrors.length||document.querySelector('#budget-harness').textContent.includes('Projected minimum'));assert.deepEqual(await page.evaluate(()=>window.testErrors),[]);return host;
}
let host=await setup();assert.equal(posts.length,0);await host.getByLabel('Budget choice').selectOption('unlimited');const confirm=host.getByRole('button',{name:'Confirm and start run'});assert.equal(await confirm.isDisabled(),true);assert.equal(posts.length,0);
await host.getByLabel('Budget choice').selectOption('limited');await host.locator('#budget-openai').fill('5.000000001');await host.locator('#budget-typesafe').fill('5');await confirm.click();await page.waitForFunction(()=>window.started);assert.deepEqual(posts.find(r=>r.url.endsWith('/api/runs')).body.budget,{mode:'limited',limits:{blended:null,openai:'5000000001',typesafe:'5000000000'},unlimitedAcknowledged:false});assert.equal(posts[0].url.endsWith('/api/quote'),true);
posts.length=0;host=await setup();await host.getByLabel('Budget choice').selectOption('unlimited');await host.getByRole('checkbox').check();changePack=true;await host.getByRole('button',{name:'Confirm and start run'}).click();await page.waitForFunction(()=>window.testErrors.some(x=>x.includes('changed')));assert.equal(await host.getByRole('checkbox').isChecked(),false);assert.equal(posts.length,0);assert.equal(await host.getByRole('button',{name:'Confirm and start run'}).isDisabled(),true);
await host.getByRole('checkbox').check();await host.getByRole('button',{name:'Confirm and start run'}).click();await page.waitForFunction(()=>window.started);assert.deepEqual(posts.find(r=>r.url.endsWith('/api/runs')).body.budget,{mode:'unlimited',limits:{blended:null,openai:null,typesafe:null},unlimitedAcknowledged:true});
console.log('Budget confirmation: 10 checks passed; fixture APIs only, no vendor calls.');
}finally{await browser.close();}
