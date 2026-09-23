import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProvisioningMutation,cloudDeployCommands} from './deploy-cloud.mjs';
const base={name:'classifier',workers_dev:true,vars:{MODEL_CALLS_ENABLED:'false'},d1_databases:[{binding:'DB',database_id:'demo',database_name:'db'}],r2_buckets:[{binding:'ARTIFACTS',bucket_name:'artifacts'}],secrets_store_secrets:[{binding:'KEY',store_id:'demo',secret_name:'key'}],workflows:[{binding:'DOCUMENT_WORKFLOW',name:'document',class_name:'DocumentWorkflow'}]};
test('provisioning may rename resources but cannot activate models',()=>{
 const next=structuredClone(base);next.name='owner-copy';next.d1_databases[0].database_id='real-id';next.secrets_store_secrets[0].store_id='real-store';
 assert.doesNotThrow(()=>validateProvisioningMutation(base,next));
 next.vars.MODEL_CALLS_ENABLED='true';assert.throws(()=>validateProvisioningMutation(base,next),/uncommitted/);
});
test('provisioning cannot change classes, bindings, routes or code',()=>{
 for(const update of [x=>x.workflows[0].class_name='Other',x=>x.d1_databases[0].binding='OTHER',x=>x.main='other.ts',x=>x.routes=['example.com/*']]){
 const next=structuredClone(base);update(next);assert.throws(()=>validateProvisioningMutation(base,next),/uncommitted/);
 }
});
test('cloud deployment gates checks then migrates binding before publishing',()=>{
 const steps=cloudDeployCommands('a'.repeat(40));assert.equal(steps[0][0],'scripts/check.mjs');
 assert.deepEqual(steps[1].slice(1,5),['d1','migrations','apply','DB']);assert.ok(steps[1].includes('--remote'));assert.equal(steps[2][1],'deploy');
 assert.ok(steps[2].includes('BUILD_COMMIT:'+'a'.repeat(40)));
});

test('derived config is used for migrations and deployment without changing command ordering',()=>{const steps=cloudDeployCommands('a'.repeat(40),'/workspace/.wrangler-install-test.jsonc');assert.equal(steps[0][0],'scripts/check.mjs');for(const step of steps.slice(1))assert.equal(step[step.indexOf('--config')+1],'/workspace/.wrangler-install-test.jsonc');assert.equal(steps[1][1],'d1');assert.equal(steps[2][1],'deploy');});
