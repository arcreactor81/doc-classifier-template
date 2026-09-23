import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {uiCopy as c} from '../core/ui/copy.ts';
// Presentation acceptance with synthetic APIs and picker. No remote calls or local originals.
const server=await createServer({server:{host:'127.0.0.1',port:0}});let browser;
try{
 await server.listen();const address=server.httpServer.address();assert.ok(address&&typeof address==='object');
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),errors=[],remote=[];let checks=0;
 const pack=JSON.parse(readFileSync('projects/generic/project.json','utf8'));
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:')&&!r.url().startsWith('blob:'))remote.push(r.url());});
 await page.addInitScript(()=>{window.showDirectoryPicker=async()=>{throw new DOMException('Cancelled','AbortError');};});
 await page.route('**/api/**',route=>{
  assert.equal(route.request().method(),'GET');const path=new URL(route.request().url()).pathname;
  if(path==='/api/project')return route.fulfill({json:pack});
  if(path==='/api/runs')return route.fulfill({json:{runs:[]}});
  if(path==='/api/health')return route.fulfill({json:{status:'NOT READY',blockers:[{code:'E_TYPE_FILE',headline:'Define between 1 and 254 types.',action:'Technical contact needed.',details:{path:'typeFile.types'}},{code:'E_MODEL_CALLS_DISABLED',headline:'Model calls are disabled.',action:'Technical contact needed.'}],versions:{},project:{},modelCallsEnabled:false,textHeldRuns:0,threshold:{value:0.9,justification:'initial_design_threshold'},vendorStatus:'not_contacted'}});
  throw new Error('Unexpected request '+path);
 });
 mkdirSync('.local/qa',{recursive:true});const screenshots=[];const base=`http://127.0.0.1:${address.port}/`;
 for(const theme of ['light','dark'])for(const [size,viewport] of [['desktop',{width:1440,height:1050}],['mobile',{width:390,height:844}]]){
  await page.setViewportSize(viewport);
  for(const route of ['home','build','correct','health','runs','help']){
   await page.goto(base+'#'+route);await page.locator('h1').waitFor();await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;localStorage.setItem('theme',theme);},theme);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,route+' overflow '+size);checks++;
   assert.equal(await page.locator('main').innerText().then(text=>/\bmanifest\b/i.test(text)),false,route+' exposes internal manifest term');checks++;
   if(['home','build','correct','health'].includes(route)){const path=`.local/qa/workspace-${route}-${theme}-${size}.jpg`;await page.screenshot({path,type:'jpeg',quality:80,fullPage:true});screenshots.push(path);}
  }
 }
 await page.goto(base+'#home');await page.getByRole('link',{name:c.heroAction,exact:true}).click();await expect(page.getByRole('button',{name:c.chooseSource,exact:true})).toBeFocused();checks++;
 await page.goto(base+'#build');await expect(page.locator('.build-selections .selection-step')).toHaveCount(3);checks++;
 await expect(page.getByLabel(c.maxPath,{exact:true})).toBeHidden();checks++;
 await page.getByText(c.buildAdvanced,{exact:true}).click();await expect(page.getByLabel(c.maxPath,{exact:true})).toHaveValue('260');checks++;
 const build=page.getByRole('button',{name:c.buildAction,exact:true});await build.click();await expect(page.getByRole('alert')).toHaveCount(1);checks++;
 const bb=await build.boundingBox(),eb=await page.getByRole('alert').boundingBox();assert.ok(bb&&eb&&eb.y>=bb.y+bb.height);checks++;
 await page.goto(base+'#correct');await expect(page.locator('.guide .workflow-steps li')).toHaveCount(3);checks++;
 await expect(page.getByLabel(c.correctionRun,{exact:true})).toBeHidden();checks++;
 await page.goto(base+'#health');await expect(page.getByText(c.setupTypeTitle,{exact:true})).toBeVisible();await expect(page.getByText(c.setupModelsTitle,{exact:true})).toBeVisible();checks+=2;
 assert.equal(await page.locator('main').innerText().then(text=>text.includes('Technical contact needed.')),false);checks++;
 await page.goto(base+'#runs');await page.getByRole('button',{name:c.startRun,exact:true}).click();await expect(page.getByRole('heading',{name:c.hero,exact:true})).toBeVisible();checks++;
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('button').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');checks++;
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);checks+=2;
 writeFileSync('.local/qa/workspace-refresh-checks.json',JSON.stringify({at:new Date().toISOString(),checks,screenshots,consoleErrors:errors,externalRequests:remote,data:'Synthetic APIs; this is UI acceptance, not deployment, model or classification evidence.'},null,2));
 console.log(`Workspace UX regression: ${checks} checks passed; ${screenshots.length} screenshots; no remote calls.`);
}finally{await browser?.close();await server.close();}
