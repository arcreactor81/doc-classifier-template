import test from 'node:test';
import assert from 'node:assert/strict';
import { executeVendor, retryDelay, type TransportDependencies, type RetryPolicy, type RawAttempt, type CallLog } from './transport.ts';
import { ValidationFailure } from './validate.ts';
import type { FrozenVendorRequest } from './requests.ts';
const request: FrozenVendorRequest = Object.freeze({ role: 'reader', endpoint: 'https://api.openai.com/v1/responses', model: 'gpt-5.6-terra', modelPolicy: { id: 'gpt-5.6-terra', policy: 'owner_approved_alias' as const, date: '2026-09-22', reason: 'User authorization' }, body: '{"model":"gpt-5.6-terra","input":"1"}' });
const policy: RetryPolicy = { transportAttempts: 3, schemaAttempts: 2, baseDelayMs: 100, maxBackoffMs: 1000, consecutiveFailureLimit: 3 };
const ok = () => new Response(JSON.stringify({ model: request.model, usage: { input_tokens: 1, output_tokens: 2 }, value: true }), { status: 200 });
function harness(responses: (Response | Error)[]) {
  const events: string[] = [], sent: RequestInit[] = [], raw: RawAttempt[] = [], logs: CallLog[] = [], sleeps: number[] = [];
  let id = 0;
  const deps: TransportDependencies = {
    fetch: async (_url, init) => { events.push('fetch'); sent.push(init); const next = responses.shift(); if (next instanceof Error) throw next; if (!next) throw new Error('Unexpected mocked request'); return next; },
    guard: async () => { events.push('guard'); }, readSecret: async () => { events.push('secret'); return 'test-only-key'; },
    now: () => 0, sleep: async milliseconds => { sleeps.push(milliseconds); }, attemptId: () => `attempt-${++id}`,
    persistRaw: async value => { events.push('persist'); raw.push(value); }, logCall: async value => { events.push('log'); logs.push(value); },
    recordDocumentOutcome: async () => 0,
  };
  return { events, sent, raw, logs, sleeps, deps };
}
const decode = (raw: unknown) => (raw as { value: boolean }).value;

test('persists exact raw response before parsing, usage log and decoding; guard runs first', async () => {
  const h = harness([ok()]);
  const result = await executeVendor(request, policy, h.deps, raw => { h.events.push('decode'); return decode(raw); });
  assert.equal(result.value, true);
  assert.deepEqual(h.events, ['guard', 'secret', 'fetch', 'persist', 'log', 'guard', 'decode']);
  assert.equal(h.logs[0].usage?.output_tokens, 2);
  assert.equal(h.logs[0].modelReturned, request.model);
  assert.equal(JSON.stringify(h.raw).includes('test-only-key'), false);
});

test('transport retries same immutable bytes, unique artifacts, honors retry-after', async () => {
  const h = harness([new Response('Busy', { status: 429, headers: { 'retry-after': '2' } }), new Response('Unavailable', { status: 503 }), ok()]);
  await executeVendor(request, policy, h.deps, decode);
  assert.deepEqual(h.sent.map(value => value.body), [request.body, request.body, request.body]);
  assert.deepEqual(h.sleeps, [2000, 200]);
  assert.equal(new Set(h.raw.map(value => value.attemptId)).size, 3);
});

test('one identical schema retry with up to three transport attempts each gives six overall', async () => {
  const h = harness([new Response('', { status: 503 }), new Response('', { status: 503 }), ok(), new Response('', { status: 503 }), new Response('', { status: 503 }), ok()]);
  let decoded = 0;
  const result = await executeVendor(request, policy, h.deps, raw => { if (++decoded === 1) throw new ValidationFailure('E_READER_SCHEMA', 'document', 'shape'); return decode(raw); });
  assert.equal(result.value, true); assert.equal(h.sent.length, 6);
  assert.equal(h.sent.every(value => value.body === request.body), true);
});

test('schema failure after one retry is terminal; model drift never retries', async () => {
  const h = harness([ok(), ok()]);
  await assert.rejects(executeVendor(request, policy, h.deps, () => { throw new ValidationFailure('E_READER_SCHEMA', 'document', 'shape'); }), (error: unknown) => (error as ValidationFailure).code === 'E_READER_SCHEMA');
  assert.equal(h.sent.length, 2);
  const drift = harness([ok(), ok()]);
  await assert.rejects(executeVendor(request, policy, drift.deps, () => { throw new ValidationFailure('E_TERRA_PIN_DRIFT', 'blocker', 'model'); }), (error: unknown) => (error as ValidationFailure).kind === 'blocker');
  assert.equal(drift.sent.length, 1);
});

test('authentication rejection persists raw and halts immediately', async () => {
  const h = harness([new Response('Denied', { status: 401 }), ok()]);
  await assert.rejects(executeVendor(request, policy, h.deps, decode), (error: unknown) => (error as ValidationFailure).code === 'E_VENDOR_AUTH');
  assert.equal(h.raw.length, 1); assert.equal(h.sent.length, 1);
});

test('kill or live gate prevents key access and any request', async () => {
  const h = harness([ok()]); h.deps.guard = async () => { throw new ValidationFailure('E_KILL_SWITCH', 'blocker', 'halt'); };
  await assert.rejects(executeVendor(request, policy, h.deps, decode));
  assert.equal(h.sent.length, 0); assert.deepEqual(h.events, []);
});

test('raw storage failure prevents parsing or retry', async () => {
  const h = harness([ok()]); h.deps.persistRaw = async () => { throw new Error('storage failure'); };
  let decoded = false;
  await assert.rejects(executeVendor(request, policy, h.deps, () => { decoded = true; return true; }), (error: unknown) => (error as ValidationFailure).code === 'E_RAW_PERSIST');
  assert.equal(decoded, false); assert.equal(h.logs.length, 0); assert.equal(h.sent.length, 1);
});

test('network failures produce typed audit without exception text and circuit breaker halts third exhausted document', async () => {
  const h = harness([new Error('private connection detail'), new Error('private connection detail'), new Error('private connection detail')]);
  h.deps.recordDocumentOutcome = async (_role, exhausted) => exhausted ? 3 : 0;
  await assert.rejects(executeVendor(request, policy, h.deps, decode), (error: unknown) => (error as ValidationFailure).code === 'E_VENDOR_CIRCUIT');
  assert.equal(h.raw.every(value => value.networkFailure && value.raw === null), true);
  assert.equal(JSON.stringify(h.logs).includes('private connection detail'), false);
});

test('missing usage halts because spend cannot be silently omitted; missing keys fail before fetch', async () => {
  const h = harness([new Response(JSON.stringify({ model: request.model, value: true }), { status: 200 })]);
  await assert.rejects(executeVendor(request, policy, h.deps, decode), (error: unknown) => (error as ValidationFailure).code === 'E_VENDOR_USAGE');
  const missing = harness([ok()]); missing.deps.readSecret = async () => null;
  await assert.rejects(executeVendor(request, policy, missing.deps, decode), (error: unknown) => (error as ValidationFailure).code === 'E_VENDOR_KEY');
  assert.equal(missing.sent.length, 0);
});

test('retry-after supports HTTP dates and invalid values fail loudly', () => {
  assert.equal(retryDelay('Tue, 22 Sep 2026 00:00:05 GMT', 1, policy, Date.parse('2026-09-22T00:00:00Z')), 5000);
  assert.equal(retryDelay(null, 3, policy, 0), 400);
  assert.throws(() => retryDelay('invalid', 1, policy, 0), /retry/i);
});

test('a model drift in a retryable HTTP error halts after persistence, before any retry', async () => {
  const h = harness([new Response(JSON.stringify({ model: 'gpt-5.6-sol', error: { code: 'server_error' } }), { status: 503 }), ok()]);
  await assert.rejects(executeVendor(request, policy, h.deps, decode), (error: unknown) => (error as ValidationFailure).code === 'E_TERRA_PIN_DRIFT');
  assert.equal(h.raw.length, 1); assert.equal(h.sent.length, 1);
});

test('confidence schema errors are terminal and cannot receive reader-only schema retry', async () => {
  const confidence: FrozenVendorRequest = { ...request, role: 'confidence', endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0', modelPolicy: { id: 'jev-1.13.0', policy: 'versioned', date: '2026-09-22', reason: 'Initial' } };
  const h = harness([new Response(JSON.stringify({ model: confidence.model, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })]);
  await assert.rejects(executeVendor(confidence, { ...policy, schemaAttempts: 1 }, h.deps, () => { throw new ValidationFailure('E_JEV_SCHEMA', 'document', 'shape'); }));
  assert.equal(h.sent.length, 1);
  await assert.rejects(executeVendor(confidence, policy, h.deps, decode), (error: unknown) => (error as ValidationFailure).code === 'E_RETRY_POLICY');
});

test('redirect responses are retained and rejected without following or retrying',async()=>{
 const h=harness([new Response('redirect-body',{status:302,headers:{location:'https://elsewhere.invalid/'}})]);
 await assert.rejects(executeVendor(request,policy,h.deps,decode),{code:'E_VENDOR_REDIRECT',kind:'document'});
 assert.equal(h.sent.length,1);assert.equal(h.sent[0].redirect,'manual');assert.equal(h.sent[0].body,request.body);assert.equal(h.raw[0].raw,'redirect-body');assert.equal(h.raw[0].networkFailure,false);assert.deepEqual(h.sleeps,[]);
});
