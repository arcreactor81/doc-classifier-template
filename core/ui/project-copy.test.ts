import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProjectCopy, validateProjectCopy } from './project-copy.ts';
import { uiCopy } from './copy.ts';

test('project copy uses product name and explicit allowed paths without mutating base copy',()=>{
 const resolved=resolveProjectCopy({productName:'Generic workspace',copyOverrides:{hero:'A place for documents.','nav.home':'Start'}});
 assert.equal(resolved.product,'Generic workspace');assert.equal(resolved.hero,'A place for documents.');assert.equal(resolved.nav.home,'Start');
 assert.equal(uiCopy.nav.home,'Home');assert.deepEqual(resolved.outcomes,uiCopy.outcomes);
});
test('unknown or protected copy override paths fail explicitly',()=>{
 for(const key of ['unknown','outcomes.0','confirm','overrideWarning','filedCount','__proto__','nav.__proto__'])assert.ok(validateProjectCopy({productName:'Workspace',copyOverrides:{[key]:'Changed'}}).length>0);
});
test('HTML, missing text and prohibited wording are rejected before presentation',()=>{
 for(const value of ['', '<b>Changed</b>', 'This is fast.', 7])assert.ok(validateProjectCopy({productName:'Workspace',copyOverrides:{hero:value}}).length>0);
 assert.ok(validateProjectCopy({productName:'',copyOverrides:{}}).length>0);
});
test('omitted overrides retain every protected outcome and action sentence',()=>{
 const result=resolveProjectCopy({productName:'Workspace'});assert.equal(result.overrideWarning,uiCopy.overrideWarning);assert.equal(result.filedCount(2,50),uiCopy.filedCount(2,50));
});

test('presentation overrides and product names cannot assign the protected filed outcome',()=>{
 assert.ok(validateProjectCopy({productName:'Workspace',copyOverrides:{hero:'Everything is filed'}}).some(issue=>issue.path==='copyOverrides.hero'));
 assert.ok(validateProjectCopy({productName:'Filed documents'}).some(issue=>issue.path==='productName'));
 assert.ok(validateProjectCopy({productName:'Workspace',copyOverrides:{lede:'Already FILED'}}).some(issue=>issue.path==='copyOverrides.lede'));
});
