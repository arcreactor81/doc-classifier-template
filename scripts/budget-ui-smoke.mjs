import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
const page=await browser.newPage();const posts=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
await page.route('**/api/health',r=>r.fulfill({json:{status:'NOT READY',blockers:[],versions:{},project:{},modelCallsEnabled:false,textHeldRuns:0}}));
await page.goto('http://127.0.0.1:5173/');
await page.getByLabel('Budget choice').waitFor();
assert.equal(await page.getByLabel('Budget choice').inputValue(),'limited');
assert.equal(await page.getByRole('button',{name:'Confirm and start run'}).isDisabled(),true);
await page.getByLabel('OpenAI · Limit in USD').fill('5');await page.getByLabel('TypeSafe · Limit in USD').fill('5');
await page.getByLabel('Budget choice').selectOption('unlimited');
const ack=page.getByRole('checkbox',{name:'I understand that this run has no spending limit and may continue incurring charges.'});
assert.equal(await ack.isChecked(),false);assert.equal(await page.locator('.budget-warning').isVisible(),true);
await ack.check();await page.getByLabel('Budget choice').selectOption('limited');await page.getByLabel('Budget choice').selectOption('unlimited');assert.equal(await ack.isChecked(),false);
await page.getByLabel('Budget choice').selectOption('limited');assert.equal(await page.getByLabel('OpenAI · Limit in USD').inputValue(),'5');
assert.deepEqual(posts,[]);
await page.route('**/api/runs/check',r=>r.fulfill({json:{run:{status:'halted',total:1,completed:0,unaccountedCalls:1,textHeld:true,spend:{blended:'3000000000',openai:'2000000000',typesafe:'1000000000'},budget:{mode:'limited',limits:{blended:null,openai:'5000000000',typesafe:'5000000000'}}},documents:[],events:[]}}));
await page.goto('http://127.0.0.1:5173/#runs/check');await page.getByRole('heading',{name:'Known spend subtotal'}).waitFor();
const rows=page.locator('table').first().locator('tbody tr');assert.equal(await rows.nth(0).textContent(),'Blended · both vendors$3.00No separate limit');assert.equal(await rows.nth(1).textContent(),'OpenAI$2.00$5.00');assert.equal(await rows.nth(2).textContent(),'TypeSafe$1.00$5.00');assert.equal(await page.getByRole('alert').filter({hasText:'Vendor calls with unaccounted spend: 1'}).count(),1);assert.deepEqual(errors,[]);
console.log('Budget UI smoke: 12 checks passed. API responses are fixtures; no vendor calls.');
}finally{await browser.close();}
