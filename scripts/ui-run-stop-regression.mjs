import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {uiCopy as c} from '../core/ui/copy.ts';
// Exercises the actual preflight controls and halted-run screen with synthetic
// responses only. No documents, live APIs, vendor calls, or run mutations.
const server=await createServer({server:{host:'127.0.0.1',port:0}});let browser;
try{
 await server.listen();const address=server.httpServer.address();assert.ok(address&&typeof address==='object');
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),errors=[],posts=[];let checks=0;
 page.on('pageerror',e=>errors.push(e.message));
 const pack=JSON.parse(readFileSync('projects/generic/project.json','utf8'));
 const reason={code:'E_SPEND_UNACCOUNTED',kind:'blocker',headline:'Vendor spending could not be accounted for.',action:'Review the recorded vendor response before starting another run.',details:{vendor:'typesafe',causeCode:'max_tokens_exceeded'}};
 await page.route('**/api/**',route=>{
  const req=route.request(),path=new URL(req.url()).pathname;if(req.method()!=='GET'){posts.push(path);throw Error('Unexpected mutation '+path);}
  if(path==='/api/health')return route.fulfill({json:{status:'READY',blockers:[],versions:{},modelCallsEnabled:false,textHeldRuns:1}});
  if(path==='/api/runs/existing')return route.fulfill({json:{run:{id:'existing',status:'halted',total:114,completed:0,textHeld:true,stopReason:reason,pendingAccounting:0,unaccountedCalls:1},documents:[],events:[]}});
  throw Error('Unexpected API '+path);
 });
 const base=`http://127.0.0.1:${address.port}/`;
 await page.goto(base+'#help');await page.locator('h1').waitFor();
 async function scenario(name,response,status='halted',readFails=false){
  await page.evaluate(async({name,response,status,readFails,pack})=>{
   const {attachRunPreflight}=await import('/preflight.ts');
   document.querySelector('#preflight-fixture')?.remove();const host=document.createElement('div');host.id='preflight-fixture';document.body.append(host);
   const mode=document.createElement('select');for(const value of ['interactive','batch']){const option=document.createElement('option');option.value=value;mode.append(option);}host.append(mode);
   localStorage.setItem('local-extraction-run','synthetic-local');localStorage.setItem('server-run:synthetic-local','existing');
   window.preflightResult={calls:[],routed:[],errors:[]};let reads=0;
   attachRunPreflight(host,mode,{ready:true,onRun:id=>window.preflightResult.routed.push(id),onError:error=>window.preflightResult.errors.push(error.message),request:async(path,body)=>{
    window.preflightResult.calls.push({path,post:body!==undefined});
    if(path==='/api/project')return pack;
    if(path==='/api/runs/existing/start'){if(response==='throw')throw Error(name);return response;}
    if(path==='/api/runs/existing'){reads++;if(reads>1&&readFails)throw Error('Read failed');return {run:{status:reads===1?'running':status}};}
    throw Error('Unexpected request '+path);
   }});
  },{name,response,status,readFails,pack});
  const resume=page.locator('#preflight-fixture').getByRole('button',{name:c.resumeUpload,exact:true});await resume.click();await expect(resume).toBeEnabled();
  const result=await page.evaluate(()=>window.preflightResult);
  assert.equal(result.calls.filter(x=>x.post).length,1);checks++;
  assert.ok(result.calls.filter(x=>x.post).every(x=>x.path==='/api/runs/existing/start'));checks++;
  return result;
 }
 for(const status of ['halted','complete','closing','closed','failed']){
  const result=await scenario('Terminal during first dispatch',{started:50,pending:64,status});
  assert.deepEqual(result.routed,['existing']);assert.deepEqual(result.errors,[]);checks+=2;
  assert.equal(result.calls.filter(x=>x.path==='/api/runs/existing').length,1);checks++;
 }
 for(const status of ['halted','complete','closing','closed']){
  const result=await scenario('Dispatch response lost','throw',status);
  assert.deepEqual(result.routed,['existing']);assert.deepEqual(result.errors,[]);checks+=2;
  assert.equal(result.calls.filter(x=>x.path==='/api/runs/existing').length,2);checks++;
 }
 for(const [status,readFails]of [['running',false],['halted',true]]){
  const result=await scenario('Original dispatch failure','throw',status,readFails);
  assert.deepEqual(result.routed,[]);assert.deepEqual(result.errors,['Original dispatch failure']);checks+=2;
  assert.equal(result.calls.filter(x=>x.path==='/api/runs/existing').length,2);checks++;
 }
 await page.goto(base+'#runs/existing');
 const stopped=page.locator('.run-stop-reason');await expect(stopped).toBeVisible();await expect(stopped).toHaveAttribute('role','alert');checks+=2;
 await expect(stopped.getByRole('heading',{name:c.runStoppedTitle,exact:true})).toBeVisible();checks++;
 await expect(stopped.getByText(reason.headline,{exact:true})).toBeVisible();await expect(stopped.getByText(reason.action,{exact:true})).toBeVisible();checks+=2;
 await expect(stopped.locator('details')).not.toHaveAttribute('open');checks++;
 await stopped.getByText(c.details,{exact:true}).click();await expect(stopped.locator('pre')).toContainText('max_tokens_exceeded');checks++;
 assert.ok((await stopped.boundingBox()).y<(await page.locator('.run-overview').boundingBox()).y);checks++;
 await expect(page.getByRole('button',{name:c.download,exact:true})).toBeDisabled();checks++;
 assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);checks+=2;
 console.log(`Run stop browser regression: ${checks} checks passed; synthetic API only, no live calls.`);
}finally{await browser?.close();await server.close();}
