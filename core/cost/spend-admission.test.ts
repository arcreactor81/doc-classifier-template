import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeRunBudget} from './run-budget.ts';
import {checkSpendAdmission,unknownSpendPolicy} from './spend-admission.ts';
const known={blended:'20',openai:'10',typesafe:'10'};
const unlimited=authorizeRunBudget({mode:'unlimited',limits:{blended:null,openai:null,typesafe:null},unlimitedAcknowledged:true},'owner','2026-09-24');
const limited=authorizeRunBudget({mode:'limited',limits:{blended:'100',openai:null,typesafe:null},unlimitedAcknowledged:false},'owner','2026-09-24');
test('only the explicitly frozen isolation policy admits unlimited runs with unresolved charges',()=>{
 assert.equal(unknownSpendPolicy(undefined),'halt-on-unknown-v1');
 for(const policy of [undefined,'halt-on-unknown-v1'] as const)assert.equal(checkSpendAdmission(policy,unlimited,known,1).reason,'unknown_spend');
 assert.deepEqual(checkSpendAdmission('isolate-unlimited-v1',unlimited,known,2),{halt:false,reason:null,reached:[],unknownCalls:2});
});
test('every limited run pauses new inference on unknown charges even below its limit',()=>{
 for(const dimension of ['blended','openai','typesafe'] as const){
  const budget={...limited,limits:{blended:null,openai:null,typesafe:null,[dimension]:'100'}};
  assert.equal(checkSpendAdmission('isolate-unlimited-v1',budget,known,1).reason,'unknown_spend');
 }
});
test('known subtotals still stop at the limit and retained unknown counts are never treated as zero',()=>{
 assert.deepEqual(checkSpendAdmission('isolate-unlimited-v1',limited,{blended:'100',openai:'90',typesafe:'10'},0),{halt:true,reason:'limit_reached',reached:['blended'],unknownCalls:0});
 assert.deepEqual(checkSpendAdmission('isolate-unlimited-v1',limited,known,0),{halt:false,reason:null,reached:[],unknownCalls:0});
});
test('invalid accounting inputs or policy never silently authorize inference',()=>{
 assert.throws(()=>unknownSpendPolicy('unknown'));
 for(const count of [-1,0.5,NaN,Infinity])assert.throws(()=>checkSpendAdmission('isolate-unlimited-v1',unlimited,known,count));
 assert.throws(()=>checkSpendAdmission('isolate-unlimited-v1',unlimited,{...known,blended:'0'},1));
});
