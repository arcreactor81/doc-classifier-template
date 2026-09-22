import { buildStructuredState } from '../digest/structured-state.ts';
﻿import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfidenceRequest, buildReaderRequest, buildRecoveryRequest, decodeConfidence, decodeReader, decodeRecovery, verifyModelPolicy, batchJsonl, parseBatchResults } from './requests.ts';
const types = { types: [{ id: 'type_a', name: 'Type A', what: 'Definition A', not_for: 'Exclusion A', examples: ['Example A'] }], none_of_these: { name: 'None', what: 'No defined type' } };
const pin = { id: 'jev-1.13.0', policy: 'versioned' as const, date: '2026-09-22', reason: 'Initial configuration' };
const alias = { ...pin, id: 'gpt-5.6-terra', policy: 'owner_approved_alias' as const };
const text = 'Source';
const readerBody = (model = alias.id) => ({ model, status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ verdicts: [{ type_id: 'type_a', is_type: true, rationale: 'Reason', evidence: ['Source'], closest_alternative: null }] }) }] }], usage: { input_tokens: 1, output_tokens: 1 } });

test('one choice and one noul per type share the exact named digest state', () => {
  const state = { title: '1', headings: [], tables: [], sections: [] };
  const request = buildConfidenceRequest({ pin, typeFile: types, serializedDigest: JSON.stringify(state) });
  const body = JSON.parse(request.body);
  assert.deepEqual(body.state, state);
  assert.deepEqual(Object.keys(body.questions), ['classification', 'is_type_a']);
  assert.deepEqual(Object.keys(body.questions.classification.criteria), ['type_a', 'none_of_these']);
  assert.equal(body.questions.is_type_a.type, 'noul');
  assert.equal(body.model, pin.id);
  assert.ok(Object.isFrozen(request));
});

test('reader request has strict schema, exact definitions before full text, output cap and no truncation/storage', () => {
  const request = buildReaderRequest({ pin: alias, typeFile: types, text, effort: 'low', maxOutputTokens: 1000 });
  const body = JSON.parse(request.body);
  assert.equal(body.text.format.strict, true); assert.equal(body.max_output_tokens, 1000);
  assert.equal(body.store, false); assert.equal(body.truncation, 'disabled');
  assert.equal(body.input.at(-1).content, text);
  assert.ok(body.input[0].content.indexOf('Output schema') < body.input[0].content.indexOf('Type definitions'));
  assert.deepEqual(JSON.parse(batchJsonl([{ customId: '1', request }])).body, body);
});

test('explicit approved model aliases accept only their own bare or dated family, preserve returned model', () => {
  verifyModelPolicy(alias, 'gpt-5.6-terra-2026-09-22', 'reader');
  assert.throws(() => verifyModelPolicy(alias, 'gpt-5.6-sol', 'reader'), /model/i);
  assert.throws(() => verifyModelPolicy(pin, 'jev-1.13', 'confidence'), /model/i);
  assert.throws(() => verifyModelPolicy({ ...alias, id: 'gpt-5.6-sol' }, 'gpt-5.6-sol', 'reader'), /policy/i);
  assert.equal(decodeReader(readerBody('gpt-5.6-terra-2026-09-22'), alias, ['type_a'], text).model, 'gpt-5.6-terra-2026-09-22');
});

test('wire adapters select unchanged fields and reject missing or extra answer keys', () => {
  const raw = { model: pin.id, answers: { classification: { type: 'choice', choice: 'type_a', confidence: 0.9, probabilities: { type_a: 0.9, none_of_these: 0.1 } }, is_type_a: { type: 'noul', noul: 0.8 } }, usage: { input_tokens: 1, output_tokens: 1 } };
  assert.equal(decodeConfidence(raw, pin, ['type_a']).nouls.type_a, 0.8);
  assert.throws(() => decodeConfidence({ ...raw, answers: { ...raw.answers, extra: {} } }, pin, ['type_a']), /answer/i);
  assert.throws(() => decodeReader({ ...readerBody(), status: 'incomplete' }, alias, ['type_a'], text), /complete/i);
});

test('recovery only locates headings and returns non-verbatim candidates for verifier rejection', () => {
  const luna = { ...alias, id: 'gpt-5.6-luna' };
  const request = buildRecoveryRequest({ pin: luna, text, effort: 'low', maxOutputTokens: 100 });
  assert.equal(JSON.parse(request.body).max_output_tokens, 100);
  const raw = readerBody(luna.id); raw.output[0].content[0].text = JSON.stringify({ headings: ['Source', 'Invented'] });
  assert.deepEqual(decodeRecovery(raw, luna), { model: luna.id, headings: ['Source', 'Invented'] });
});

test('batch validation keys every result by custom id and rejects partial, duplicate or unrelated results', () => {
  const line = JSON.stringify({ custom_id: '1', response: { status_code: 200, request_id: 'request', body: readerBody() }, error: null });
  assert.equal(parseBatchResults(line, ['1'])[0].customId, '1');
  assert.throws(() => parseBatchResults(line, ['1', '2']), /missing/i);
  assert.throws(() => parseBatchResults(line + '\n' + line, ['1']), /duplicate/i);
  assert.throws(() => parseBatchResults(line, ['2']), /unexpected/i);
});

test('reader and recovery explicitly disable implicit cache breakpoints without adding cache markers', () => {
  const reader = JSON.parse(buildReaderRequest({ pin: alias, typeFile: types, text, effort: 'low', maxOutputTokens: 1000 }).body);
  const recovery = JSON.parse(buildRecoveryRequest({ pin: { ...alias, id: 'gpt-5.6-luna' }, text, effort: 'low', maxOutputTokens: 100 }).body);
  for (const body of [reader, recovery]) {
    assert.deepEqual(body.prompt_cache_options, { mode: 'explicit' });
    assert.equal(JSON.stringify(body.input).includes('prompt_cache_breakpoint'), false);
    assert.equal(body.input.at(-1).content, text);
  }
});

test('current untrimmed structured state reaches the confidence request without loss or local token count',()=>{
 const fullText='[Page 1]\n'+ 'Complete source '.repeat(1000);
 const state=buildStructuredState(fullText,{headings:[],tables:[],blocks:[{position:9,text:fullText.slice(9)}]},[]);
 const request=buildConfidenceRequest({pin,typeFile:types,serializedDigest:state.serialized});
 assert.deepEqual(JSON.parse(request.body).state,state.state);assert.equal(JSON.parse(request.body).state.fullText,fullText);assert.equal(state.tokenCount,null);
 for(const fullText of [null,0,''])assert.throws(()=>buildConfidenceRequest({pin,typeFile:types,serializedDigest:JSON.stringify({...state.state,fullText})}));
 assert.throws(()=>buildConfidenceRequest({pin,typeFile:types,serializedDigest:JSON.stringify({...state.state,unknown:'field'})}));
});
