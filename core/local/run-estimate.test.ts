import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatePreparedRun } from './run-estimate.ts';
import type { ProjectPack } from '../config/project.ts';
const pack={settings:{readerMaxOutputTokens:50},limits:{confidenceRequestsPerMinute:120,readerRequestsPerMinute:60,readerTokensPerMinute:1000,readerBatchEnqueuedTokens:1000}} as ProjectPack;
const document={fingerprint:'a'.repeat(64),originalFilename:'one.docx',tokenCounts:{readerInputTokens:null,confidenceInputTokens:null,recoveryInputTokens:null},needsOutlineRecovery:false,failed:false};
test('run preview needs neither prices nor cost token counts and makes no cost claim',()=>{
 for(const mode of ['interactive','batch'] as const){const result=estimatePreparedRun([document],pack,mode);assert.equal(result.mode,mode);assert.equal(result.duration.interactiveMinimumSecondsAtPublishedLimits,null);assert.equal('estimate' in result,false);assert.equal('projectLimitNanodollars' in result,false);}
});
test('known token counts still enforce known Batch capacity and support duration',()=>{
 const known={...document,tokenCounts:{readerInputTokens:200,confidenceInputTokens:null,recoveryInputTokens:null}};
 assert.equal(estimatePreparedRun([known],pack,'interactive').duration.interactiveMinimumSecondsAtPublishedLimits,15);
 assert.throws(()=>estimatePreparedRun([known],{...pack,limits:{...pack.limits,readerBatchEnqueuedTokens:199}},'batch'),/allowance/i);
});
test('unknown usage is distinct from failed-only zero demand and empty selections',()=>{
 assert.equal(estimatePreparedRun([{...document,failed:true}],pack,'interactive').duration.interactiveMinimumSecondsAtPublishedLimits,0);
 assert.throws(()=>estimatePreparedRun([],pack,'interactive'));
});
