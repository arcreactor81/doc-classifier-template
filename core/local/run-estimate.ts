import { projectInteractiveSeconds, type ProjectPack } from '../config/project.ts';
import { estimateRunCost, type CostDocument, type CostEstimate } from '../cost/cost.ts';
import type { QuoteDocument } from './preflight.ts';
import { uiCopy } from '../ui/copy.ts';
import { EXECUTION_ATTEMPTS } from '../cost/policy.ts';
export interface LocalEstimate { batchCapacity:{allowance:number|null}; estimate:CostEstimate;projectLimitNanodollars:string;duration:{interactiveMinimumSecondsAtPublishedLimits:number|null;batchMaximumHours:number};mode:'interactive'|'batch' }
/** Pure local arithmetic; this function cannot upload filenames, fingerprints, counts or text. */
export function estimatePreparedRun(documents:readonly QuoteDocument[],pack:ProjectPack,mode:'interactive'|'batch'):LocalEstimate{
  if(!documents.length)throw new Error(uiCopy.chooseFirst);
  const costs:CostDocument[]=documents.filter(document=>!document.failed).map(document=>({id:document.fingerprint,confidence:{inputTokens:document.tokenCounts.confidenceInputTokens,maxOutputTokens:0},reader:{inputTokens:document.tokenCounts.readerInputTokens,maxOutputTokens:pack.settings.readerMaxOutputTokens},recovery:document.needsOutlineRecovery?{inputTokens:document.tokenCounts.recoveryInputTokens,maxOutputTokens:pack.settings.recoveryMaxOutputTokens}:null}));
  const readerTokens=costs.reduce((sum,document)=>sum+document.reader.inputTokens+document.reader.maxOutputTokens,0);
  const batchTokens=costs.reduce((sum,document)=>sum+document.reader.inputTokens,0);
  if(!Number.isSafeInteger(readerTokens)||!Number.isSafeInteger(batchTokens))throw new Error(uiCopy.tokenizerUnavailable);
  if(mode==='batch'&&pack.limits.readerBatchEnqueuedTokens!==null&&batchTokens>pack.limits.readerBatchEnqueuedTokens)throw new Error(uiCopy.batchCapacityExceeded);
  const seconds=projectInteractiveSeconds(costs.length,readerTokens,pack.limits);
  return {batchCapacity:{allowance:pack.limits.readerBatchEnqueuedTokens},estimate:estimateRunCost({documents:costs,rates:pack.prices[mode],attempts:EXECUTION_ATTEMPTS}),projectLimitNanodollars:pack.budget.limitNano,duration:{interactiveMinimumSecondsAtPublishedLimits:seconds,batchMaximumHours:24},mode};
}

