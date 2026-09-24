import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recoveryReadiness} from './recovery-readiness.ts';
import {READER_PROMPT_VERSION} from '../vendors/requests.ts';
import {authorizeRunBudget} from '../cost/run-budget.ts';
import type {Store,RunRow} from './store.ts';
const pack=JSON.parse(readFileSync('projects/validation/project.json','utf8'));
function fixture(){let kill=0,version=READER_PROMPT_VERSION;const env={MODEL_CALLS_ENABLED:'true',DB:{prepare:(sql:string)=>({bind(){return this;},first:async()=>sql.includes('controls')?{kill}:{estimate_json:JSON.stringify({readerPromptVersion:version})}})},OPENAI_API_KEY:{get:async()=> 'local-only'},JEV_API_KEY:{get:async()=> 'local-only'}} as unknown as Env;const store={env,spendByVendor:async()=>({blended:'1',openai:'1',typesafe:'0'}),unaccounted:async()=>0} as unknown as Store;const run={id:'run',pack_json:JSON.stringify(pack),budget_json:JSON.stringify(authorizeRunBudget({mode:'unlimited',limits:{blended:null,openai:null,typesafe:null},unlimitedAcknowledged:true},'owner','2026-09-24T00:00:00Z'))} as RunRow;return{env,store,run,kill:()=>kill=1,change:()=>version='changed'};}
test('continuation validates original frozen configuration and spending without active revision lookup',async()=>{const f=fixture();await recoveryReadiness(f.store,f.run);});
test('continuation refuses kill switch, disabled models, changed reader contract and exhausted budget',async()=>{
 const killed=fixture();killed.kill();await assert.rejects(recoveryReadiness(killed.store,killed.run),{code:'E_KILL_SWITCH'});
 const disabled=fixture();disabled.env.MODEL_CALLS_ENABLED='false';await assert.rejects(recoveryReadiness(disabled.store,disabled.run),{code:'E_MODEL_CALLS_DISABLED'});
 const changed=fixture();changed.change();await assert.rejects(recoveryReadiness(changed.store,changed.run),{code:'E_RECOVERY_REQUEST_POLICY'});
 const limited=fixture();limited.run.budget_json=JSON.stringify(authorizeRunBudget({mode:'limited',limits:{blended:'1',openai:null,typesafe:null},unlimitedAcknowledged:false},'owner','2026-09-24T00:00:00Z'));await assert.rejects(recoveryReadiness(limited.store,limited.run),{code:'E_LIVE_BUDGET'});
});
