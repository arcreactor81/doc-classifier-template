import {chromium, expect} from '@playwright/test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {uiCopy as c} from '../core/ui/copy.ts';

// Mocked health checks exercise presentation and navigation, not live Access security.
const server=await createServer({server:{host:'127.0.0.1',port:0}});
let browser;
try{
 await server.listen();const address=server.httpServer.address();assert.ok(address&&typeof address==='object');
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage(),requests=[],pageErrors=[];let authenticated=false,checks=0;
 page.on('pageerror',error=>pageErrors.push(error.message));
 await page.addInitScript(()=>{window.showDirectoryPicker=async()=>{throw new Error('Unexpected picker');};});
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;requests.push(path);assert.equal(route.request().method(),'GET');
  if(path==='/api/health')return route.fulfill({json:authenticated?
   {status:'NOT READY',blockers:[{code:'E_MODEL_CALLS_DISABLED',headline:'Model calls are disabled.',action:'Finish setup before activation.'}],signIn:{mode:'cloudflare',authenticated:true},versions:{},project:{},modelCallsEnabled:false,textHeldRuns:0}:
   {status:'NOT READY',blockers:[{code:'E_ACCESS_SETUP',headline:'Sign-in is not enabled.',action:'Enable sign-in.'}],signIn:{mode:'cloudflare',authenticated:false},modelCallsEnabled:false}});
  assert.equal(authenticated,true);assert.equal(path,'/api/runs');return route.fulfill({json:{runs:[]}});
 });
 const base=`http://127.0.0.1:${address.port}/`;
 await page.goto(base);
 await expect(page.getByRole('heading',{name:c.signInSetupTitle,exact:true})).toBeVisible();checks++;
 await expect(page.getByRole('navigation')).toBeHidden();checks++;
 await expect(page.locator('input,select')).toHaveCount(0);checks++;
 await expect(page.getByRole('button',{name:c.chooseSource,exact:true})).toHaveCount(0);checks++;
 await expect(page.locator('.sign-in-setup ol li')).toHaveCount(4);checks++;
 const enable=page.getByRole('link',{name:c.signInEnable,exact:true});
 await expect(enable).toHaveAttribute('href','https://dash.cloudflare.com/?to=/:account/workers-and-pages');checks++;
 await expect(enable).toHaveAttribute('target','_blank');checks++;
 await expect(enable).toHaveAttribute('rel','noopener noreferrer');checks++;
 const theme=await page.locator('html').getAttribute('data-theme');await page.getByRole('button',{name:c.theme,exact:true}).click();
 assert.notEqual(await page.locator('html').getAttribute('data-theme'),theme);checks++;
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks++;
 await expect(enable).toBeVisible();await expect(page.getByRole('button',{name:c.signInCheck,exact:true})).toBeVisible();checks++;
 const oldTheme=await page.locator('html').getAttribute('data-theme');const oldRequests=requests.length;
 await Promise.all([page.waitForEvent('framenavigated'),page.getByRole('button',{name:c.signInCheck,exact:true}).click()]);
 await expect(page.getByRole('heading',{name:c.signInSetupTitle,exact:true})).toBeVisible();assert.ok(requests.length>oldRequests);checks++;
 await expect(page.locator('html')).toHaveAttribute('data-theme',oldTheme);checks++;
 for(const hash of ['#runs','#build','#correct','#health']){
  await page.goto(base+hash);await expect(page.getByRole('heading',{name:c.signInSetupTitle,exact:true})).toBeVisible();checks++;
 }
 assert.deepEqual([...new Set(requests)],['/api/health']);checks++;
 authenticated=true;await page.goto(base+'#runs');await expect(page.getByRole('heading',{name:c.runs,exact:true})).toBeVisible();checks++;
 await expect(page.getByRole('navigation')).toBeVisible();await expect(page.locator('.sign-in-setup')).toHaveCount(0);checks++;
 assert.ok(requests.includes('/api/runs'));checks++;
 assert.deepEqual(pageErrors,[]);checks++;
 console.log(`Sign-in onboarding browser regression: ${checks} checks passed; mocked health only, no real Access proof or remote mutations.`);
}finally{await browser?.close();await server.close();}
