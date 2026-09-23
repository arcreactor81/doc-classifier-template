import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage(),posts=[];let checks=0;
 await page.addInitScript(()=>{window.pickerCalls=0;window.showDirectoryPicker=async()=>{window.pickerCalls++;const file=name=>({kind:'file',name,getFile:async()=>new File(['local fixture'],name)});return{kind:'directory',name:'tree',async*values(){yield{kind:'directory',name:'human_review',async*values(){yield file('r1-1--document.pdf');yield file('r1-1--document.pdf.md');}};}};};});
 await page.route('**/api/**',async route=>{const r=route.request();if(r.method()==='POST'){posts.push(JSON.parse(r.postData()));await route.fulfill({status:409,json:{error:'fixture refuses writes'}});return;}
 await route.fulfill({json:r.url().endsWith('/health')?{status:'READY',blockers:[],versions:{},project:{},modelCallsEnabled:false,textHeldRuns:0,threshold:{value:0.91,justification:'correction-reference'},vendorStatus:'not_contacted'}:{}});});
 await page.goto('http://127.0.0.1:5173/#correct');
 await page.getByText('Run identifier',{exact:true}).first().click();await page.getByLabel('Run identifier').fill('run1');await page.getByRole('button',{name:'Choose corrected output folder',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.pickerCalls),0);checks++;
 const manifest=runId=>({runId,entries:[{fingerprint:'a'.repeat(64),tag:'r1-1',originalFilename:'document.pdf',destinationFolder:'human_review',rule:'R2'}]});
 async function load(runId){const choice=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose results file',exact:true}).click();await(await choice).setFiles({name:'manifest.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest(runId)))});}
 await load('run1');await page.getByRole('button',{name:'Choose corrected output folder',exact:true}).click();await page.getByText('Documents in the corrected folder: 1',{exact:true}).waitFor();checks++;
 await page.getByRole('button',{name:'Review corrections',exact:true}).click();await page.waitForTimeout(100);assert.equal(posts.length,1);assert.equal(posts[0].files.length,1);assert.deepEqual(posts[0].sidecarPaths,['human_review/r1-1--document.pdf.md']);checks+=3;
 await page.getByLabel('Run identifier').fill('run2');await page.getByRole('button',{name:'Review corrections',exact:true}).click();await page.waitForTimeout(100);assert.equal(posts.length,1);checks++;
 await page.getByLabel('Run identifier').fill('run1');await page.getByRole('button',{name:'Review corrections',exact:true}).click();await page.waitForTimeout(100);assert.equal(posts.length,1);checks++;
 await page.getByRole('button',{name:'Choose corrected output folder',exact:true}).click();await page.getByText('Documents in the corrected folder: 1',{exact:true}).waitFor();await load('run2');await page.getByRole('button',{name:'Review corrections',exact:true}).click();await page.waitForTimeout(100);assert.equal(posts.length,1);checks++;
 await page.evaluate(()=>{const original=window.showDirectoryPicker;window.showDirectoryPicker=()=>new Promise(resolve=>{window.releasePicker=async()=>resolve(await original());});});
 await page.getByRole('button',{name:'Choose corrected output folder',exact:true}).click();await page.getByLabel('Run identifier').fill('run3');await page.evaluate(()=>window.releasePicker());await page.waitForTimeout(100);
 assert.equal(await page.getByText('Documents in the corrected folder: 1',{exact:true}).count(),0);checks++;
 await page.getByRole('button',{name:'Review corrections',exact:true}).click();await page.waitForTimeout(100);assert.equal(posts.length,1);checks++;
 await page.goto('http://127.0.0.1:5173/health');await page.getByText('Current threshold: 0.91',{exact:true}).waitFor();await page.getByText('Threshold justification: correction-reference',{exact:true}).waitFor();await page.getByText('Vendor status: No inference calls have been recorded.',{exact:true}).waitFor();checks+=3;
 for(const [vendorStatus,label,httpStatus] of [['no_response','The latest inference attempt received no HTTP response.',null],['response_failed','The latest inference attempt received an unsuccessful HTTP response.',429],['response_received','An HTTP success response was recorded. This alone does not establish a valid model result.',200]]){
  await page.route('**/api/health',route=>route.fulfill({json:{status:'READY',blockers:[],versions:{},project:{},modelCallsEnabled:false,textHeldRuns:0,vendorStatus,vendorHistory:{latest:{role:'confidence',httpStatus,at:'2026-09-22T12:00:00Z'},unknownSpendCount:3}}}));
  await page.goto('http://127.0.0.1:5173/health');await page.getByText('Vendor status: '+label,{exact:true}).waitFor();await page.getByText('Calls with unknown spend: 3',{exact:true}).waitFor();assert.equal(await page.getByRole('cell',{name:'Confidence check',exact:true}).count(),1);checks+=3;
  await page.unroute('**/api/health');
 }
 console.log(`Correction identity and Health browser regression: ${checks} checks passed; no real API mutations.`);
}finally{await browser.close();}
