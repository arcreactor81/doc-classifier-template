import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedBatchCostFailure} from './batch-runner.ts';
import {authorizeRunBudget} from '../cost/run-budget.ts';
import type {ProjectPack} from '../config/project.ts';
import type {Runner} from './execution.ts';
import type {BatchResult} from '../vendors/requests.ts';
const pack={settings:{unknownSpendPolicy:'isolate-unlimited-v1'},pins:{reader:{id:'gpt-6-sol',policy:'owner_approved_alias'}}} as ProjectPack;
const result=(status=200,body:unknown={model:'gpt-6-sol'}):BatchResult=>({customId:'doc',response:{status_code:status,request_id:null,body},error:null});
function runner(cost:string|null|undefined,limited=false){return{run:{budget_json:JSON.stringify(authorizeRunBudget({mode:limited?'limited':'unlimited',limits:{blended:limited?'100':null,openai:null,typesafe:null},unlimitedAcknowledged:!limited},'owner','2026-09-24'))},env:{DB:{prepare:()=>({bind:()=>({first:async()=>cost===undefined?null:{cost_nano:cost}})})}}} as unknown as Runner;}
test('retained unknown Batch attempt stops only its document without authorizing a retry',async()=>{
 for(const response of [result(),result(520,{error:'unavailable'})])assert.equal((await retainedBatchCostFailure(runner(null),pack,'attempt',response))?.code,'E_VENDOR_COST_UNKNOWN');
 assert.equal(await retainedBatchCostFailure(runner('0'),pack,'attempt',result()),null);
});
test('legacy Batch policy is unchanged and limited policy blocks unknown charges',async()=>{
 assert.equal(await retainedBatchCostFailure(runner(null),{...pack,settings:{...pack.settings,unknownSpendPolicy:undefined}},'attempt',result()),null);
 await assert.rejects(()=>retainedBatchCostFailure(runner(null,true),pack,'attempt',result()),{code:'E_SPEND_UNACCOUNTED'});
});
test('Batch global model auth quota and missing accounting record retain priority',async()=>{
 await assert.rejects(()=>retainedBatchCostFailure(runner(null),pack,'attempt',result(200,{model:'different'})),{kind:'blocker'});
 for(const status of [401,403])await assert.rejects(()=>retainedBatchCostFailure(runner(null),pack,'attempt',result(status,{})),{code:'E_VENDOR_AUTH'});
 await assert.rejects(()=>retainedBatchCostFailure(runner(null),pack,'attempt',result(429,{error:{code:'insufficient_quota'}})),{code:'E_OPENAI_QUOTA'});
 await assert.rejects(()=>retainedBatchCostFailure(runner(undefined),pack,'attempt',result()),{code:'E_VENDOR_LOG'});
});
