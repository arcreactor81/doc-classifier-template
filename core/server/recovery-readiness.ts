import {requireRunProject} from '../config/project.ts';
import {checkSpendAdmission} from '../cost/spend-admission.ts';
import {readRunBudget} from '../cost/run-budget.ts';
import {READER_PROMPT_VERSION} from '../vendors/requests.ts';
import {ServerFailure} from './errors.ts';
import type {Store,RunRow} from './store.ts';
/** Resume only the frozen request contract and original spending choice; no active-category substitution. */
export async function recoveryReadiness(store:Store,run:RunRow):Promise<void>{
 const pack=requireRunProject(JSON.parse(run.pack_json));
 const control=await store.env.DB.prepare('SELECT kill FROM controls WHERE id=1').first<{kill:number}>();
 if(!control)throw new ServerFailure('E_STORAGE_D1','blocker','Run controls are unavailable.');
 if(control.kill)throw new ServerFailure('E_KILL_SWITCH','blocker','The kill switch is set.');
 if(String(store.env.MODEL_CALLS_ENABLED)!=='true')throw new ServerFailure('E_MODEL_CALLS_DISABLED','blocker','Model calls are disabled.');
 const quote=await store.env.DB.prepare('SELECT estimate_json FROM quotes WHERE id=(SELECT quote_id FROM runs WHERE id=?)').bind(run.id).first<{estimate_json:string}>();
 if(!quote||JSON.parse(quote.estimate_json).readerPromptVersion!==READER_PROMPT_VERSION)throw new ServerFailure('E_RECOVERY_REQUEST_POLICY','blocker','The saved request contract differs from this deployment. It cannot be continued safely.');
 const admission=checkSpendAdmission(pack.settings.unknownSpendPolicy,readRunBudget(JSON.parse(run.budget_json)),await store.spendByVendor(run.id),await store.unaccounted(run.id));
 if(admission.reason==='unknown_spend')throw new ServerFailure('E_SPEND_UNACCOUNTED','blocker','An unresolved charge prevents continuation under these spending settings.');
 if(admission.reason==='limit_reached')throw new ServerFailure('E_LIVE_BUDGET','blocker','The original spending limit has been reached.');
 for(const binding of [store.env.JEV_API_KEY,store.env.OPENAI_API_KEY])if(!binding||!await binding.get())throw new ServerFailure('E_VENDOR_KEY','blocker','A vendor credential is unavailable.');
}
