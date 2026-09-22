import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const pack=JSON.parse(await fs.readFile('projects/generic/project.json','utf8'));
pack.typeFile.types=[]; // An intentionally unconfigured taxonomy must still display a valid run-mode suggestion.
pack.settings.defaultMode='batch';pack.settings.batchCutoff=10;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{const page=await browser.newPage();await page.route('**/api/**',r=>r.fulfill({json:{status:'NOT READY',blockers:[],versions:{},project:{},modelCallsEnabled:false,textHeldRuns:0}}));await page.goto('http://127.0.0.1:5173/#help');
const result=await page.evaluate(async({pack,base})=>{const {attachRunPreflight}=await import(base+'/ui/app/preflight.ts');const host=document.createElement('section'),mode=document.createElement('select');for(const value of ['interactive','batch']){const option=document.createElement('option');option.value=value;mode.append(option);}host.append(mode);document.body.append(host);let resolve;const pending=new Promise(r=>resolve=r);const errors=[];attachRunPreflight(host,mode,{ready:false,request:async()=>pending,onError:e=>errors.push(e.message),onRun:()=>{throw Error('unexpected run');}});const before=mode.value;mode.value='interactive';mode.dispatchEvent(new Event('change'));resolve(pack);await new Promise(r=>setTimeout(r,50));const afterFetch=mode.value;window.dispatchEvent(new CustomEvent('local-extraction-count',{detail:20}));const afterCount=mode.value;window.dispatchEvent(new Event('local-extraction-changed'));const afterNewSelection=mode.value;return{before,afterFetch,afterCount,afterNewSelection,errors};},{pack,base:'/@fs/'+process.cwd().replaceAll('\\','/')});
assert.deepEqual(result,{before:'',afterFetch:'interactive',afterCount:'interactive',afterNewSelection:'batch',errors:[]});console.log('Mode selection: 5 checks passed; delayed project fetch preserves explicit choice and new selection restores configured suggestion; no vendor calls.');
}finally{await browser.close();}
