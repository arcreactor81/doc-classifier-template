import {chromium, expect} from '@playwright/test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';

// Synthetic picker and HTTP responses exercise the real UI only. No local documents
// are read, and all API requests are intercepted before they reach a server.
const server=await createServer({server:{host:'127.0.0.1',port:0}});
let browser;
try{
 await server.listen();
 const address=server.httpServer.address();
 assert.ok(address&&typeof address==='object');
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage(),posts=[],pageErrors=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 let responseMode='failure',checks=0,releaseFirstResponse;
 const firstResponse=new Promise(resolve=>{releaseFirstResponse=resolve;});
 const failure={code:'E_CORRECTION_AMBIGUOUS_IDENTITY',headline:'A document appears more than once in the corrected tree.',action:'Keep one copy of each tagged document, then choose the whole output folder again.'};
 const result={correctionId:'correction1',diff:{deleted:[]},proposals:{filedCheck:{wrong:0,checked:1,status:'insufficient_sample'},raise:null,lower:null,moves:[],unresolvedFolders:[],unmatched:[],examples:[],notFor:[],newTypes:[]}};
 await page.addInitScript(()=>{
  window.cancelPicker=false;
  window.showDirectoryPicker=async()=>{
   if(window.cancelPicker)throw new DOMException('Cancelled','AbortError');
   return{kind:'directory',name:'tree',async*values(){yield{kind:'directory',name:'type_a',async*values(){yield{kind:'file',name:'r1-1--document.pdf'};}};}};
  };
 });
 await page.route('**/api/**',async route=>{
  const request=route.request();
  if(request.method()==='POST'){
   assert.equal(new URL(request.url()).pathname,'/api/runs/run1/corrections');
   posts.push(request.postDataJSON());
   if(posts.length===1)await firstResponse;
   return responseMode==='success'?route.fulfill({json:result}):route.fulfill({status:400,json:{error:{...failure,details:{requestId:'attempt-'+posts.length}}}});
  }
  assert.equal(new URL(request.url()).pathname,'/api/health');
  return route.fulfill({json:{status:'READY',blockers:[],versions:{},project:{},modelCallsEnabled:false,textHeldRuns:0}});
 });
 await page.goto(`http://127.0.0.1:${address.port}/#correct`);
 const manifest={runId:'run1',entries:[{fingerprint:'a'.repeat(64),tag:'r1-1',originalFilename:'document.pdf',destinationFolder:'type_a',rule:'R1'}]};
 async function loadManifest(){
  const chooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Choose manifest JSON',exact:true}).click();
  await(await chooser).setFiles({name:'manifest.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))});
  await expect(page.getByRole('button',{name:'Choose manifest JSON',exact:true})).toBeEnabled();
 }
 const tree=page.getByRole('button',{name:'Choose corrected tree',exact:true});
 const review=page.getByRole('button',{name:'Review corrections',exact:true});
 const alerts=page.getByRole('alert');
 async function scan(){await tree.click();await expect(tree).toBeEnabled();await expect(page.getByText('Files in corrected tree: 1',{exact:true})).toBeVisible();}
 async function failReview(){await review.click();await expect(review).toBeEnabled();await expect(alerts.getByRole('heading',{name:failure.headline,exact:true})).toBeVisible();}
 await loadManifest();await scan();await page.getByLabel('type_a',{exact:true}).check();
 await review.click();await expect(review).toBeDisabled();
 const pending=page.getByRole('status');await expect(pending).toHaveText('Loading\u2026');checks++;
 assert.equal(await review.evaluate(button=>Boolean(button.nextElementSibling?.querySelector('[role=status]'))),true);checks++;
 releaseFirstResponse();await expect(review).toBeEnabled();await expect(pending).toHaveCount(0);checks++;
 await review.click();await expect(review).toBeEnabled();
 await expect(alerts).toHaveCount(1);checks++;
 assert.equal(await review.evaluate(button=>Boolean(button.nextElementSibling?.querySelector('[role=alert]'))),true);checks++;
 const buttonBounds=await review.boundingBox(),alertBounds=await alerts.boundingBox();
 assert.ok(buttonBounds&&alertBounds&&alertBounds.y>=buttonBounds.y+buttonBounds.height);checks++;
 await expect(alerts.getByText(failure.action,{exact:true})).toBeVisible();checks++;
 await expect(alerts.locator('details')).not.toHaveAttribute('open');checks++;
 await alerts.getByText('Technical details',{exact:true}).click();
 await expect(alerts.locator('pre')).toContainText('attempt-2');checks++;
 await expect(alerts.locator('pre')).toContainText('E_CORRECTION_AMBIGUOUS_IDENTITY');checks++;
 await expect(alerts.locator('pre')).toContainText('400');checks++;
 assert.deepEqual(posts[0],posts[1]);checks++;
 assert.deepEqual(posts[0].checkedFolders,['type_a']);checks++;
 await page.getByRole('button',{name:'Change colour theme',exact:true}).click();
 await expect(alerts).toHaveCount(1);checks++;
 await page.evaluate(()=>{window.cancelPicker=true;});await tree.click();await expect(tree).toBeEnabled();
 await expect(alerts).toHaveCount(1);checks++;
 await page.evaluate(()=>{window.cancelPicker=false;});await scan();
 await expect(alerts).toHaveCount(0);checks++;
 await expect(page.getByText('Choose the whole output folder containing the category folders, not an individual category folder.',{exact:true})).toBeVisible();checks++;
 await failReview();await loadManifest();
 await expect(alerts).toHaveCount(0);checks++;
 await scan();await failReview();responseMode='success';await review.click();
 await expect(page.getByRole('heading',{name:'Proposals for Git review',exact:true})).toBeVisible();
 await expect(alerts).toHaveCount(0);checks++;
 assert.equal(await review.evaluate(button=>Boolean(button.nextElementSibling?.nextElementSibling?.querySelector('.proposal-review'))),true);checks++;
 assert.equal(posts.length,5);checks++;
 assert.deepEqual(pageErrors,[]);checks++;
 console.log(`Correction action-error browser regression: ${checks} checks passed; synthetic picker/API only, no live mutations.`);
}finally{
 await browser?.close();
 await server.close();
}
