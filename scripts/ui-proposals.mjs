import {chromium} from '@playwright/test';import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage(),posts=[];
 const example={tag:'r1-1',title:'<b>Example</b>',digestLines:['Source excerpt']};
 const proposals={filedCheck:{wrong:0,checked:1,status:'insufficient_sample'},raise:null,lower:null,moves:[],unresolvedFolders:[],unmatched:[],examples:[{...example,typeId:'type_a'}],notFor:[{fromType:'type_a',toType:'type_b',candidate:'Review this distinction.',evidenceTags:['r1-1']}],newTypes:[{folder:'New group',id:null,name:'New group',what:'',not_for:'',examples:[{tag:null,title:'Document',digestLines:[]}],status:'proposed_type_not_yet_defined'}]};
 const result={correctionId:'correction1',proposals,diff:{deleted:[]},proposalContext:{unavailableTags:['r1-1'],reason:'source_text_not_retained'}};
 await page.addInitScript(()=>{window.showDirectoryPicker=async()=>({kind:'directory',name:'tree',async*values(){yield{kind:'directory',name:'type_a',async*values(){yield{kind:'file',name:'r1-1--document.pdf'};}};}});});
 await page.route('**/api/**',route=>{if(route.request().method()==='POST'){posts.push(route.request().url());return route.fulfill({json:result});}return route.fulfill({json:{status:'READY',blockers:[],versions:{},project:{},modelCallsEnabled:false,textHeldRuns:0}});});
 await page.goto('http://127.0.0.1:5173/#correct');const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose manifest JSON'}).click();await(await chooser).setFiles({name:'manifest.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({runId:'run1',entries:[{fingerprint:'a'.repeat(64),tag:'r1-1',originalFilename:'document.pdf',destinationFolder:'type_a',rule:'R1'}]}))});
 await page.getByRole('button',{name:'Choose corrected tree'}).click();await page.getByText('Files in corrected tree: 1',{exact:true}).waitFor();await page.getByRole('button',{name:'Review corrections',exact:true}).click();
 await page.getByRole('heading',{name:'Proposed examples',exact:true}).waitFor({timeout:3000});await page.getByRole('heading',{name:'Proposed exclusions',exact:true}).waitFor();await page.getByRole('heading',{name:'Proposed types',exact:true}).waitFor();
 assert.equal(await page.getByText('<b>Example</b>',{exact:true}).count(),1);assert.equal(await page.locator('section b').count(),0);
 await page.getByText('Choose an identifier in Git.',{exact:true}).waitFor();await page.getByText('Complete the definition and exclusions in Git before deploying this type.',{exact:true}).waitFor();
 const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download proposals JSON',exact:true}).click();const d=await event,stream=await d.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()),{runId:'run1',...result});
 assert.equal(posts.length,1);assert.equal(await page.getByRole('button',{name:/Apply this threshold/}).count(),0);
 console.log('Correction proposal browser regression: 10 checks passed; downloaded exact fixture, no real mutations.');
}finally{await browser.close();}
