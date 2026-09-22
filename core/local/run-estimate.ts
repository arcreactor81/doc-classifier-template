import { projectInteractiveSeconds, type ProjectPack } from '../config/project.ts';
import type { QuoteDocument } from './preflight.ts';
import { uiCopy } from '../ui/copy.ts';
export interface LocalEstimate { batchCapacity:{allowance:number|null};duration:{interactiveMinimumSecondsAtPublishedLimits:number|null;batchMaximumHours:number};mode:'interactive'|'batch' }
/** Local run preview only. No billing estimate or upload; unknown counts remain unknown. */
export function estimatePreparedRun(documents:readonly QuoteDocument[],pack:ProjectPack,mode:'interactive'|'batch'):LocalEstimate{
 if(!documents.length)throw new Error(uiCopy.chooseFirst);
 const active=documents.filter(document=>!document.failed);
 const counts=active.map(document=>document.tokenCounts.readerInputTokens);
 const known=counts.every((count):count is number=>count!==null);
 let seconds:number|null=null;
 if(known){
  if(counts.some(count=>!Number.isSafeInteger(count)||count<0))throw new Error(uiCopy.tokenizerUnavailable);
  const batchTokens=counts.reduce((sum,count)=>sum+count,0),readerTokens=batchTokens+active.length*pack.settings.readerMaxOutputTokens;
  if(!Number.isSafeInteger(readerTokens))throw new Error(uiCopy.tokenizerUnavailable);
  if(mode==='batch'&&pack.limits.readerBatchEnqueuedTokens!==null&&batchTokens>pack.limits.readerBatchEnqueuedTokens)throw new Error(uiCopy.batchCapacityExceeded);
  seconds=projectInteractiveSeconds(active.length,readerTokens,pack.limits);
 }
 return {batchCapacity:{allowance:pack.limits.readerBatchEnqueuedTokens},duration:{interactiveMinimumSecondsAtPublishedLimits:seconds,batchMaximumHours:24},mode};
}
