import test from 'node:test';
import assert from 'node:assert/strict';
import { executeVendor, retryDelay, type TransportDependencies, type RetryPolicy, type RawAttempt, type CallLog } from './transport.ts';
import { ValidationFailure } from './validate.ts';
import { ServerFailure } from '../server/errors.ts';
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

test('OpenAI permanent quota 429 persists and accounts response before blocker without retry', async () => {
  for (const code of ['insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded']) {
    const h = harness([new Response(JSON.stringify({ error: { type: 'insufficient_quota', code } }), { status: 429 }), ok()]);
    await assert.rejects(executeVendor(request, policy, h.deps, decode), (error: unknown) => (error as ValidationFailure).code === 'E_OPENAI_QUOTA');
    assert.deepEqual(h.events, ['guard', 'secret', 'fetch', 'persist', 'log']);
    assert.equal(h.sent.length, 1); assert.equal(h.raw.length, 1); assert.equal(h.logs.length, 1); assert.deepEqual(h.sleeps, []);
  }
});

test('permanent quota diagnosis takes precedence over the post-response unknown-spend guard without another request', async () => {
  const h = harness([new Response(JSON.stringify({ error: { type: 'insufficient_quota', code: 'credit_balance_exhausted' } }), { status: 429 }), ok()]);
  let guardCalls = 0;
  h.deps.guard = async () => { h.events.push('guard'); if (++guardCalls === 2) throw new ServerFailure('E_SPEND_UNACCOUNTED', 'blocker', 'A vendor response has unaccounted spending.'); };
  await assert.rejects(executeVendor(request, policy, h.deps, decode), (error: unknown) => (error as { code: string }).code === 'E_OPENAI_QUOTA');
  assert.equal(guardCalls, 1); assert.equal(h.sent.length, 1); assert.equal(h.raw.length, 1); assert.equal(h.logs.length, 1); assert.deepEqual(h.sleeps, []);
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

test('shared admission happens before secret or attempt allocation and rechecks guard after waking',async()=>{
 const h=harness([ok()]);let resume!:()=>void,waiting=false,ids=0,stopped=false;h.deps.attemptId=()=>{ids++;return 'sent-1';};h.deps.awaitAdmission=async()=>{waiting=true;await new Promise<void>(resolve=>{resume=resolve;});};h.deps.guard=async()=>{if(stopped)throw new Error('budget or kill stop');};
 const pending=executeVendor(request,policy,h.deps,decode);await Promise.resolve();await Promise.resolve();assert.equal(waiting,true);assert.equal(ids,0);assert.equal(h.events.includes('secret'),false);assert.equal(h.sent.length,0);stopped=true;resume();await assert.rejects(pending,/budget or kill/);assert.equal(ids,0);assert.equal(h.logs.length,0);
});
test('only explicit temporary429 hints are shared after raw persistence and call logging',async()=>{
 const h=harness([new Response('{}',{status:429,headers:{'retry-after':'2'}}),ok()]);h.deps.observeRetryAfter=async attempt=>{h.events.push('observed');assert.equal(attempt.status,429);assert.equal(attempt.retryAfter,'2');assert.equal(h.raw.length,1);assert.equal(h.logs.length,1);};await executeVendor(request,policy,h.deps,decode);assert.ok(h.events.indexOf('observed')>h.events.indexOf('log'));assert.deepEqual(h.sent.map(s=>s.body),[request.body,request.body]);assert.equal(h.logs.length,2);
 const noHint=harness([new Response('{}',{status:429}),ok()]);noHint.deps.observeRetryAfter=async()=>{throw Error('No explicit hint');};await executeVendor(request,policy,noHint.deps,decode);
 const permanent=harness([new Response(JSON.stringify({error:{code:'insufficient_quota'}}),{status:429,headers:{'retry-after':'2'}})]);permanent.deps.observeRetryAfter=async()=>{throw Error('Must not share permanent quota');};await assert.rejects(executeVendor(request,policy,permanent.deps,decode),{code:'E_OPENAI_QUOTA'});
});

test('approved Luna6 recovery transport works in production and still validates explicit evaluation policy',async()=>{
 const custom={...request,role:'recovery' as const,model:'gpt-6-luna',modelPolicy:{...request.modelPolicy,id:'gpt-6-luna'},body:'{"model":"gpt-6-luna"}'};
 const make=()=>harness([new Response(JSON.stringify({model:'gpt-6-luna',usage:{input_tokens:1,output_tokens:2},value:true}))]);
 const recoveryPolicy={...policy,schemaAttempts:1};
 const production=make();assert.equal((await executeVendor(custom,recoveryPolicy,production.deps,decode)).value,true);assert.equal(production.sent.length,1);
 const blocked=make();await assert.rejects(executeVendor({...custom,model:'gpt-6-astra',modelPolicy:{...custom.modelPolicy,id:'gpt-6-astra'}},recoveryPolicy,blocked.deps,decode),/policy/);assert.equal(blocked.sent.length,0);
 const allowed=make();assert.equal((await executeVendor(custom,recoveryPolicy,allowed.deps,decode,{purpose:'owner_authorized_evaluation',role:'recovery',authorization:'explicit isolated experiment',models:['gpt-6-luna']})).value,true);
});

test('approved production Sol retries only identical bytes and rejects Terra responses without fallback',async()=>{
 const sol={...request,model:'gpt-6-sol',modelPolicy:{...request.modelPolicy,id:'gpt-6-sol'},body:'{"model":"gpt-6-sol","input":"1"}'};
 const success=new Response(JSON.stringify({model:sol.model,usage:{input_tokens:1,output_tokens:2},value:true}));
 const h=harness([new Response('Busy',{status:503}),success]);assert.equal((await executeVendor(sol,policy,h.deps,decode)).value,true);
 assert.deepEqual(h.sent.map(sent=>sent.body),[sol.body,sol.body]);assert.equal(h.logs.at(-1)?.modelReturned,'gpt-6-sol');
 const drift=harness([ok()]);await assert.rejects(executeVendor(sol,policy,drift.deps,decode),{code:'E_TERRA_PIN_DRIFT',kind:'blocker'});assert.equal(drift.sent.length,1);assert.equal(drift.raw.length,1);
});
