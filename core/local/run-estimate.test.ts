import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatePreparedRun } from './run-estimate.ts';
import type { ProjectPack } from '../config/project.ts';
const rate=(input:string,output:string)=>({inputNanodollarsPerMillion:input,outputNanodollarsPerMillion:output});
const pack={settings:{readerMaxOutputTokens:50,recoveryMaxOutputTokens:20},prices:{interactive:{confidence:rate('1000000000','0'),reader:rate('2000000000','4000000000'),recovery:rate('1000000000','2000000000')},batch:{confidence:rate('1000000000','0'),reader:rate('1000000000','2000000000'),recovery:rate('1000000000','2000000000')}},budget:{limitNano:'9000000'},limits:{confidenceRequestsPerMinute:120,readerRequestsPerMinute:60,readerTokensPerMinute:1000,readerBatchEnqueuedTokens:1000}} as unknown as ProjectPack;
const document={fingerprint:'a'.repeat(64),originalFilename:'one.docx',tokenCounts:{readerInputTokens:200,confidenceInputTokens:100,recoveryInputTokens:0},needsOutlineRecovery:false,failed:false};
test('local preview includes bounded attempts, output caps and published-limit duration before upload',()=>{
 const result=estimatePreparedRun([document,{...document,fingerprint:'b'.repeat(64),failed:true}],pack,'interactive');
 assert.equal(result.estimate.worstCaseNanodollars,'3900000');assert.equal(result.estimate.estimateNanodollars,'700000');assert.equal(result.duration.interactiveMinimumSecondsAtPublishedLimits,15);assert.equal(result.projectLimitNanodollars,'9000000');
});
test('Batch preview applies its configured prices and rejects impossible initial enqueued demand',()=>{
 assert.equal(estimatePreparedRun([document],pack,'batch').estimate.worstCaseNanodollars,'2100000');
 assert.throws(()=>estimatePreparedRun([document],{...pack,limits:{...pack.limits,readerBatchEnqueuedTokens:199}},'batch'),/allowance/i);
});
test('failed-only preview has zero model calls and empty document selection cannot appear ready',()=>{
 const result=estimatePreparedRun([{...document,failed:true}],pack,'interactive');assert.equal(result.estimate.worstCaseNanodollars,'0');assert.equal(result.duration.interactiveMinimumSecondsAtPublishedLimits,0);
 assert.throws(()=>estimatePreparedRun([],pack,'interactive'));
});


test('unknown throughput produces unavailable projection without changing cost or blocking modes',()=>{
 for(const field of ['confidenceRequestsPerMinute','readerRequestsPerMinute','readerTokensPerMinute']){
  const unknown={...pack,limits:{...pack.limits,[field]:null}};
  for(const mode of ['interactive','batch'] as const){
   const result=estimatePreparedRun([document],unknown,mode);
   assert.equal(result.duration.interactiveMinimumSecondsAtPublishedLimits,null);
   assert.deepEqual(result.estimate,estimatePreparedRun([document],pack,mode).estimate);
  }
 }
 const unknownBatch={...pack,limits:{...pack.limits,readerBatchEnqueuedTokens:null}};
 assert.deepEqual(estimatePreparedRun([document],unknownBatch,'batch').estimate,estimatePreparedRun([document],pack,'batch').estimate);
});

test('failed-only run needs no throughput projection even when rates are unknown',()=>{
 const unknown={...pack,limits:{...pack.limits,readerRequestsPerMinute:null,readerTokensPerMinute:null,confidenceRequestsPerMinute:null}};
 assert.equal(estimatePreparedRun([{...document,failed:true}],unknown,'interactive').duration.interactiveMinimumSecondsAtPublishedLimits,0);
});
