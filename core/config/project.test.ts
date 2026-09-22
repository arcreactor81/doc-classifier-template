import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTypes, validateProject, typeVersion } from './project.ts';
const types={types:[{id:'type_a',name:'Category A',what:'Material about alpha',not_for:'Material about beta',examples:['A synthetic example']}],none_of_these:{name:'None of these',what:'No defined type applies'}};
test('type validation requires complete unique nonreserved definitions',()=>{
 assert.deepEqual(validateTypes(types),[]);
 for(const bad of [{...types,types:[]},{...types,types:[types.types[0],types.types[0]]},{...types,types:[{...types.types[0],id:'human_review'}]},{...types,types:[{...types.types[0],examples:[]}]}]) assert.ok(validateTypes(bad).length);
});
test('structural vocabulary collision checks every word in names descriptions examples',()=>{
 const base={schemaVersion:1,id:'generic',productName:'Document classifier',typeFile:types,structuralVocabulary:['alpha']};
 assert.ok(validateProject(base).some(x=>x.code==='E_VOCABULARY_COLLISION'));
 assert.ok(validateProject({...base,structuralVocabulary:['SYNTHETIC']}).some(x=>x.code==='E_VOCABULARY_COLLISION'));
});
test('missing configuration stays missing rather than gaining defaults',()=>{
 const issues=validateProject({});
 for(const field of ['typeFile','settings','pins','tokenizers','limits']) assert.ok(issues.some(x=>x.path.startsWith(field)));
});
test('type versions hash exact source bytes and reject mutation assumptions',async()=>{
 assert.equal(await typeVersion('a'),await typeVersion('a'));
 assert.notEqual(await typeVersion('a'),await typeVersion('a '));
 assert.match(await typeVersion('a'),/^[a-f0-9]{64}$/);
});

test('pricing requires verified complete integer rates and valid long-context multipliers',()=>{
 const rate={inputNanodollarsPerMillion:'42',outputNanodollarsPerMillion:'0'};
 const prices={verifiedAt:'2026-09-22',source:['https://docs.typesafe.ai/models'],interactive:{confidence:rate,reader:rate,recovery:rate},batch:{confidence:rate,reader:rate,recovery:rate}};
 const errors=(value:unknown)=>validateProject({prices:value}).filter(x=>x.path.startsWith('prices'));
 assert.deepEqual(errors(prices),[]);
 for(const bad of [null,{}, {...prices,source:[]},{...prices,batch:{}},{...prices,interactive:{...prices.interactive,reader:{...rate,inputNanodollarsPerMillion:'-1'}}},{...prices,interactive:{...prices.interactive,reader:{...rate,longContext:{aboveInputTokens:272000,inputMultiplier:{numerator:'2',denominator:'0'},outputMultiplier:{numerator:'3',denominator:'2'}}}}}]) assert.ok(errors(bad).length);
});

test('project validation rejects unknown and protected presentation override paths',()=>{
 for(const key of ['unknown','outcomes.0','overrideWarning']){
  const issues=validateProject({productName:'Workspace',copyOverrides:{[key]:'Changed'}});
  assert.ok(issues.some(issue=>issue.code==='E_PROJECT_COPY'&&issue.path==='copyOverrides.'+key));
 }
 assert.equal(validateProject({productName:'Workspace',copyOverrides:{hero:'A place for documents.'}}).some(issue=>issue.code==='E_PROJECT_COPY'),false);
});

test('Batch input-token allowance cannot be guessed from a model context limit',()=>{
 for(const readerBatchEnqueuedTokens of [undefined,0,-1,1.5])assert.ok(validateProject({limits:{readerBatchEnqueuedTokens}}).some(issue=>issue.path==='limits.readerBatchEnqueuedTokens'));
 assert.equal(validateProject({limits:{readerBatchEnqueuedTokens:1000}}).some(issue=>issue.path==='limits.readerBatchEnqueuedTokens'),false);
});

test('explicit unknown throughput limits are valid while missing or invalid values are rejected',()=>{
 const fields=['readerRequestsPerMinute','readerTokensPerMinute','readerBatchEnqueuedTokens','confidenceRequestsPerMinute'];
 for(const field of fields){
  for(const value of [null,1,500])assert.equal(validateProject({limits:{[field]:value}}).some(issue=>issue.path==='limits.'+field),false);
  for(const value of [undefined,0,-1,1.5,'unknown'])assert.ok(validateProject({limits:{[field]:value}}).some(issue=>issue.path==='limits.'+field));
 }
 for(const field of ['readerContextTokens','confidenceStateQuestionTokens','confidenceAllQuestionTokens'])assert.ok(validateProject({limits:{[field]:null}}).some(issue=>issue.path==='limits.'+field));
});

test('run-selected budgets replace project spending approval and reader billing-tokenizer gates',()=>{
 const issues=validateProject({budget:null,tokenizers:{confidence:{id:'official',verifiedAt:'2026-09-22',source:'https://docs.typesafe.ai'},reader:null}});
 assert.equal(issues.some(x=>x.path==='budget'||x.path==='tokenizers.reader'),false);
 assert.ok(validateProject({tokenizers:{confidence:null}}).some(x=>x.path==='tokenizers.confidence'));
});
