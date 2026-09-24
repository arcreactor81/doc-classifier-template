import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const server=await createServer({server:{host:'127.0.0.1',port:5173,strictPort:true}});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();let posts=0;let status='halted';const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let value;
 if(path==='/api/health')value={status:'READY',blockers:[],versions:{},project:{productName:'Document workspace'},modelCallsEnabled:true};
 else if(path==='/api/runs/example')value={run:{status,total:4,completed:1,recoveryAvailable:status==='halted',recovery:null,unaccountedCalls:0,pendingAccounting:0,spend:{blended:'100',openai:'0',typesafe:'100'},budget:{mode:'unlimited'},textHeld:true,stopReason:status==='halted'?{code:'E_WORKFLOW_INTERRUPTED',headline:'Runtime interrupted',action:'Saved work is preserved.'}:null},documents:[],events:[]};
 else if(path.endsWith('/comparison'))value=null;
 else if(path.endsWith('/corrections'))value={corrections:[]};
 else if(path.endsWith('/recover')){assert.equal(route.request().method(),'POST');assert.deepEqual(route.request().postDataJSON(),{acknowledged:true});posts++;value={started:2,pending:posts===1?1:0,status:'running'};if(posts===2)status='running';}
 else throw Error('Unexpected request '+path);
 await route.fulfill({json:value});});
 await page.goto('http://127.0.0.1:5173/#runs/example');const button=page.getByRole('button',{name:'Continue saved processing',exact:true});await button.waitFor();assert.equal(await button.isDisabled(),true);assert.equal(posts,0);
 await page.getByLabel("Continue the remaining work using this run's original categories and spending settings.").check();assert.equal(posts,0);await button.click();await page.waitForFunction(()=>document.body.innerText.includes('running')&&!document.body.innerText.includes('Runtime interrupted'));assert.equal(posts,2);assert.deepEqual(errors,[]);
 console.log('Recovery UI: consent required; no automatic POST; bounded continuation uses original run; running is not reported complete; zero live vendor calls.');
}finally{await browser.close();await server.close();}
