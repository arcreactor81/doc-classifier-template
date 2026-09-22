import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLocalRun } from './preflight.ts';
import { parseUpload } from '../server/contracts.ts';
import type { ProjectPack } from '../config/project.ts';
import type { LocalDocument } from './state.ts';
const pack={settings:{confidenceStatePolicy:'untrimmed-structured-state-v2'},structuralVocabulary:[],budget:null} as unknown as ProjectPack;
const local={runId:'local',sourcePath:'one.docx',fingerprint:'a'.repeat(64),state:'extracted',document:{fingerprint:'a'.repeat(64),originalFilename:'one.docx',fullText:'A heading\nBody',outline:{title:'A heading',headings:[],tables:[],blocks:[{position:0,text:'A heading\nBody'}]},extractorVersion:'test',parserVersions:{zip:'test',xml:'test',pdf:'test'},needsOutlineRecovery:false}} as LocalDocument;
test('preparation requires no local token codec and represents unknown billing counts explicitly',()=>{
 const [result]=prepareLocalRun([local],pack);
 assert.deepEqual(result.quote.tokenCounts,{readerInputTokens:null,confidenceInputTokens:null,recoveryInputTokens:null});
 assert.equal(parseUpload(result.upload).tokenizerIds.reader,null);
});
test('outline recovery is no longer blocked by an unavailable cost prediction',()=>{
 const recovery={...local,document:{...('document' in local?local.document:{}),needsOutlineRecovery:true}} as LocalDocument;
 assert.equal(prepareLocalRun([recovery],pack)[0].quote.needsOutlineRecovery,true);
});
test('invalid token claims are rejected without requiring a local tokenizer',()=>{
 const result=prepareLocalRun([local],pack)[0];
 for(const value of [-1,1.5,'unknown',undefined])assert.throws(()=>parseUpload({...result.upload,tokenCounts:{readerInputTokens:value,confidenceInputTokens:null,recoveryInputTokens:null}}));
});

test('failed documents remain explicit zero-call entries without uploaded text',()=>{
 const failed:LocalDocument={runId:'local',sourcePath:'one.bin',fingerprint:'b'.repeat(64),state:'could_not_process',failure:{code:'E_UNSUPPORTED_FORMAT',message:'Unsupported file type.'}};
 const [result]=prepareLocalRun([failed],pack);assert.equal(result.quote.failed,true);assert.deepEqual(result.quote.tokenCounts,{readerInputTokens:0,confidenceInputTokens:0,recoveryInputTokens:0});assert.equal('fullText' in result.upload,false);
});
test('unfinished extraction and duplicate content cannot silently shrink the run',()=>{
 assert.throws(()=>prepareLocalRun([{runId:'local',sourcePath:'one',fingerprint:'a'.repeat(64),state:'not started'}],pack),/extraction/i);
 assert.throws(()=>prepareLocalRun([local,{...local,sourcePath:'other'}],pack),/duplicate/i);
});
