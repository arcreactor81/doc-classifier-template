import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareLocalRun } from './preflight.ts';
import { codecFor } from './tokenizers.ts';
import type { ProjectPack } from '../config/project.ts';
import type { LocalDocument } from './state.ts';
import { buildReaderRequest, buildConfidenceRequest } from '../vendors/requests.ts';
import { buildDigest, DIGEST_POLICY_VERSION } from '../digest/digest.ts';

const codec={id:'test_codec',countTokens:(text:string)=>text.length,prefixWithinBudget:(text:string,fits:(text:string)=>boolean)=>{let result='';for(const char of text){if(!fits(result+char))break;result+=char;}return result;}};
const pack={typeFile:{types:[{id:'type_a',name:'A',what:'B',not_for:'C',examples:['D']}],none_of_these:{name:'E',what:'F'}},pins:{reader:{id:'gpt-5.6-terra',policy:'owner_approved_alias',date:'2026-09-22',reason:'owner'},confidence:{id:'jev-1.13.0',policy:'versioned',date:'2026-09-22',reason:'owner'}},settings:{readerEffort:'low',readerMaxOutputTokens:100,digestBudget:6000},structuralVocabulary:[],budget:{approvedBy:'owner',approvedAt:'2026-09-22'},tokenizers:{reader:{id:codec.id},confidence:{id:codec.id}}} as unknown as ProjectPack;
const document={fingerprint:'a'.repeat(64),originalFilename:'type_a.docx',fullText:String.fromCharCode(71,72),outline:{headings:[],tables:[],blocks:[{position:0,text:String.fromCharCode(71,72)}]},extractorVersion:'1',parserVersions:{zip:'1',xml:'1',pdf:'1'},needsOutlineRecovery:false};
const local:LocalDocument={runId:'local',sourcePath:document.originalFilename,fingerprint:document.fingerprint,state:'extracted',document};

test('verified tokenizer registry has no invented codec fallback',()=>{assert.throws(()=>codecFor('missing'),error=>error instanceof Error&&'code' in error&&error.code==='E_TOKENIZER_UNVERIFIED');});
test('preflight counts exact shared request bodies including schemas and taxonomy',()=>{
 const [prepared]=prepareLocalRun([local],pack,{reader:codec,confidence:codec});
 const reader=buildReaderRequest({pin:pack.pins.reader,typeFile:pack.typeFile,text:document.fullText,effort:pack.settings.readerEffort,maxOutputTokens:pack.settings.readerMaxOutputTokens});
 const digest=buildDigest(document.outline,{budget:6000,vocabulary:[],codec,policy:{version:DIGEST_POLICY_VERSION,acceptedBy:pack.budget.approvedBy,acceptedAt:pack.budget.approvedAt,tokenizerId:codec.id}});
 const confidence=buildConfidenceRequest({pin:pack.pins.confidence,typeFile:pack.typeFile,serializedDigest:digest.serialized});
 assert.equal(prepared.quote.tokenCounts.readerInputTokens,reader.body.length);
 assert.equal(prepared.quote.tokenCounts.confidenceInputTokens,confidence.body.length);
 assert.ok(prepared.quote.tokenCounts.readerInputTokens>document.fullText.length);
 assert.equal(prepared.quote.failed,false);
});
test('recovery cannot receive an invented confidence-token ceiling',()=>{assert.throws(()=>prepareLocalRun([{...local,document:{...document,needsOutlineRecovery:true}}],pack,{reader:codec,confidence:codec}),/recovery/i);});
test('failed documents are explicit zero-call quote items and text-free uploads',()=>{
 const failed:LocalDocument={runId:'local',sourcePath:'type_a.bin',fingerprint:'b'.repeat(64),state:'could_not_process',failure:{code:'E_UNSUPPORTED_FORMAT',message:'Unsupported file type.'}};
 const [result]=prepareLocalRun([failed],pack,{reader:codec,confidence:codec});
 assert.equal(result.quote.failed,true);assert.deepEqual(result.quote.tokenCounts,{readerInputTokens:0,confidenceInputTokens:0,recoveryInputTokens:0});assert.equal('fullText' in result.upload,false);
});
test('unfinished extraction and duplicate content cannot silently shrink the run',()=>{
 assert.throws(()=>prepareLocalRun([{runId:'local',sourcePath:'a',fingerprint:'a'.repeat(64),state:'not started'}],pack,{reader:codec,confidence:codec}),/extraction/i);
 assert.throws(()=>prepareLocalRun([local,{...local,sourcePath:'other'}],pack,{reader:codec,confidence:codec}),/duplicate/i);
});
