import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadBatchInput, createBatch, pollBatch, ingestBatchResults, validateBatchInput, type BatchDependencies, type BatchContext, type BatchSnapshot } from './batch.ts';
import { buildReaderRequest } from './requests.ts';
const context: BatchContext = { runId: 'run1', batchKey: 'group1', modelPolicy: { id: 'gpt-5.6-terra', policy: 'owner_approved_alias', date: '2026-09-22', reason: 'Owner approval' } };
const io = { maxMetadataBytes: 1000000, maxResultLineBytes: 1000000, streamChunkBytes: 7 };
const request = buildReaderRequest({ pin: context.modelPolicy, typeFile: { types: [{ id: 'type_a', name: 'A', what: 'A definition', not_for: 'Exclusion', examples: ['A example'] }], none_of_these: { name: 'None', what: 'No fit' } }, text: 'Text', effort: 'low', maxOutputTokens: 100 });
const batch = (status = 'completed') => ({ id: 'batch_1', input_file_id: 'file_input', endpoint: '/v1/responses', completion_window: '24h', status, output_file_id: 'file_output', error_file_id: null, request_counts: { total: 1, completed: 1, failed: 0 } });
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
function harness(responses: (Response | Error)[]) {
  let nextId = 0;
  const order: string[] = [], requests: { url: string; body: string; init: RequestInit }[] = [], states: unknown[] = [], chunks: Uint8Array[] = [], staged: unknown[] = [];
  const deps: BatchDependencies = {
    fetch: async (url, init) => { requests.push({ url, body: init.body ? await new Response(init.body).text() : '', init }); order.push('fetch'); const response = responses.shift(); if (response instanceof Error) throw response; if (!response) throw new Error('Unexpected request'); return response; },
    guard: async () => { order.push('guard'); }, readSecret: async () => 'test-key', now: () => 0, attemptId: () => `attempt${++nextId}`,
    persistRaw: async () => { order.push('persist'); }, logCall: async () => { order.push('log'); }, persistBatchState: async state => { states.push(state); order.push('state'); },
    persistChunk: async chunk => { chunks.push(chunk.bytes.slice()); order.push('chunk'); },
    stageResult: async value => { staged.push(value); order.push('stage'); return `result${staged.length}`; },
  };
  return { deps, order, requests, states, chunks, staged };
}
const line = (customId: string) => JSON.stringify({ custom_id: customId, response: { status_code: 200, request_id: 'r1', body: { model: context.modelPolicy.id, usage: { input_tokens: 1, output_tokens: 1 } } }, error: null });

test('upload streams exact request JSONL as purpose=batch and persists file ID', async () => {
  const h = harness([json({ id: 'file_input', purpose: 'batch' })]);
  const uploaded = await uploadBatchInput([{ customId: '1', request }], context, h.deps, io);
  assert.equal(uploaded.fileId, 'file_input'); assert.equal(uploaded.requestCount, 1);
  assert.ok(h.requests[0].body.includes('name="purpose"\r\n\r\nbatch'));
  assert.ok(h.requests[0].body.includes(`"body":${request.body}`));
  assert.ok(h.order.indexOf('persist') < h.order.indexOf('state'));
  assert.equal(h.states.length, 1);
});

test('create records durable batch identity and uses responses endpoint plus 24h window', async () => {
  const h = harness([json(batch('validating')), json(batch())]);
  const created = await createBatch('file_input', context, h.deps, io);
  assert.equal(created.id, 'batch_1');
  assert.deepEqual(JSON.parse(h.requests[0].body), { input_file_id: 'file_input', endpoint: '/v1/responses', completion_window: '24h', metadata: { run_id: 'run1', batch_key: 'group1' } });
  assert.equal((await pollBatch(created.id, context, h.deps, io)).status, 'completed');
  assert.equal(h.states.length, 2);
});

test('POST network uncertainty never retries and guard prevents every external operation', async () => {
  const h = harness([new Error('uncertain')]);
  await assert.rejects(createBatch('file_input', context, h.deps, io), (error: unknown) => (error as { code: string }).code === 'E_BATCH_SUBMISSION_UNCERTAIN');
  assert.equal(h.requests.length, 1);
  h.deps.guard = async () => { throw new Error('kill'); };
  await assert.rejects(pollBatch('batch_1', context, h.deps, io));
  assert.equal(h.requests.length, 1);
});

test('input validation enforces exact IDs, UTF8 accounting, 50000 requests and 200MB cap', () => {
  const one = validateBatchInput([{ customId: '1', request }], context);
  assert.ok(one.inputBytes > request.body.length);
  assert.throws(() => validateBatchInput([{ customId: '1', request }, { customId: '1', request }], context), /duplicate/i);
  assert.throws(() => validateBatchInput(Array.from({ length: 50001 }, (_, n) => ({ customId: String(n), request })), context), /50,000/);
  assert.throws(() => validateBatchInput([{ customId: '1', request: { ...request, body: request.body + ' '.repeat(200000) } }], context, 1000), /byte/i);
});

async function snapshot(): Promise<BatchSnapshot> {
  const h = harness([json(batch())]); return pollBatch('batch_1', context, h.deps, io);
}
test('result retrieval streams persisted byte chunks before parsing, preserves split Unicode', async () => {
  const source = line('1').replace('"request_id":"r1"', '"request_id":"é"') + '\n';
  const h = harness([new Response(source)]);
  const result = await ingestBatchResults(await snapshot(), ['1'], context, h.deps, io);
  assert.equal(result.results.length, 1); assert.deepEqual(result.failures, []);
  assert.ok(h.chunks.every(chunk => chunk.byteLength <= io.streamChunkBytes));
  assert.ok(h.order.indexOf('chunk') < h.order.indexOf('stage'));
  assert.equal(new TextDecoder().decode(Buffer.concat(h.chunks)), source);
});

test('duplicate and missing IDs become explicit document failures, never partial successes', async () => {
  const h = harness([new Response(line('1') + '\n' + line('1') + '\n')]);
  const result = await ingestBatchResults(await snapshot(), ['1', '2'], context, h.deps, io);
  assert.equal(result.results.length, 0);
  assert.deepEqual(result.failures.map(failure => failure.code).sort(), ['E_BATCH_DUPLICATE_RESULT', 'E_BATCH_MISSING_RESULT']);
});

test('unknown IDs and malformed lines halt; only terminal batches can be ingested', async () => {
  const h = harness([new Response(line('2'))]);
  await assert.rejects(ingestBatchResults(await snapshot(), ['1'], context, h.deps, io), /unexpected/i);
  const state = await snapshot(); state.status = 'in_progress';
  await assert.rejects(ingestBatchResults(state, ['1'], context, h.deps, io), /terminal/i);
});

test('expired batches retain explicit vendor errors and mark missing documents expired', async () => {
  const state = await snapshot(); state.status = 'expired'; state.outputFileId = null; state.errorFileId = 'file_errors';
  const h = harness([new Response(JSON.stringify({ custom_id: '1', response: null, error: { code: 'batch_expired', message: 'Expired' } }))]);
  const result = await ingestBatchResults(state, ['1', '2'], context, h.deps, io);
  assert.equal(result.results.length, 0); assert.equal(result.failures.length, 2);
  assert.equal(result.failures[1].code, 'E_BATCH_EXPIRED');
});

test('failed result retrieval retains raw error chunks and logs before halting', async () => {
  const h = harness([new Response('Denied response body', { status: 401 })]);
  await assert.rejects(ingestBatchResults(await snapshot(), ['1'], context, h.deps, io), (error: unknown) => (error as { code: string }).code === 'E_VENDOR_AUTH');
  assert.equal(new TextDecoder().decode(Buffer.concat(h.chunks)), 'Denied response body');
  assert.ok(h.order.includes('log'));
});

test('returned model mismatch blocks classification after retaining every received result for accounting', async () => {
  const h = harness([new Response(line('1').replace('gpt-5.6-terra', 'gpt-5.6-sol')+'\n'+line('2'))]);
  await assert.rejects(ingestBatchResults(await snapshot(), ['1','2'], context, h.deps, io), (error: unknown) => (error as { code: string }).code === 'E_TERRA_PIN_DRIFT');
  assert.equal(h.staged.length, 2); assert.ok(h.chunks.length > 0);
});

test('stream storage failure prevents result parsing; oversized lines fail visibly', async () => {
  const h = harness([new Response(line('1'))]); h.deps.persistChunk = async () => { throw new Error('storage'); };
  await assert.rejects(ingestBatchResults(await snapshot(), ['1'], context, h.deps, io), (error: unknown) => (error as { code: string }).code === 'E_RAW_PERSIST');
  assert.equal(h.staged.length, 0);
  const limited = harness([new Response(line('1'))]);
  await assert.rejects(ingestBatchResults(await snapshot(), ['1'], context, limited.deps, { ...io, maxResultLineBytes: 10 }), /limit/i);
});
