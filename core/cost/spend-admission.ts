import {checkRunBudget,type RunBudget,type Spend,type SpendDimension} from './run-budget.ts';
/** Missing on a historical frozen pack means the historical fail-closed policy. */
export type UnknownSpendPolicy='halt-on-unknown-v1'|'isolate-unlimited-v1';
export function unknownSpendPolicy(value:unknown):UnknownSpendPolicy{
 if(value===undefined)return 'halt-on-unknown-v1';
 if(value==='halt-on-unknown-v1'||value==='isolate-unlimited-v1')return value;
 throw new Error('Unknown spending admission policy.');
}
export interface SpendAdmission {halt:boolean;reason:'unknown_spend'|'limit_reached'|null;reached:SpendDimension[];unknownCalls:number}
/** Admission only: no inference, retries, accounting mutation or conversion of unknown charges to zero. */
export function checkSpendAdmission(policy:unknown,budget:RunBudget,knownSpend:Spend,unknownCalls:number):SpendAdmission{
 const resolved=unknownSpendPolicy(policy);
 if(!Number.isSafeInteger(unknownCalls)||unknownCalls<0)throw new Error('Unknown-charge count must be a nonnegative integer.');
 const checked=checkRunBudget(budget,knownSpend);
 const unknownBlocks=unknownCalls>0&&(resolved==='halt-on-unknown-v1'||budget.mode!=='unlimited');
 return{halt:unknownBlocks||checked.halt,reason:unknownBlocks?'unknown_spend':checked.halt?'limit_reached':null,reached:checked.reached,unknownCalls};
}
