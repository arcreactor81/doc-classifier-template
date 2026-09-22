import type { ModelPin } from '../config/project.ts';
import { batchJsonl, parseBatchResults, verifyModelPolicy, type FrozenVendorRequest, type BatchResult } from './requests.ts';
import type { TransportDependencies, RawAttempt } from './transport.ts';
import { ValidationFailure } from './validate.ts';

export const BATCH_MAX_REQUESTS = 50_000;
export const BATCH_MAX_INPUT_BYTES = 200_000_000;
export interface BatchContext { runId: string; batchKey: string; modelPolicy: ModelPin }
export interface BatchIOPolicy { maxMetadataBytes: number; maxResultLineBytes: number; streamChunkBytes: number }
export interface BatchInputEntry { customId: string; request: FrozenVendorRequest }
export type BatchStatus = 'validating' | 'failed' | 'in_progress' | 'finalizing' | 'completed' | 'expired' | 'cancelling' | 'cancelled';
export interface BatchSnapshot {
  id: string; inputFileId: string; status: BatchStatus; outputFileId: string | null; errorFileId: string | null;
  requestCounts: { total: number; completed: number; failed: number }; rawReference: string; retryAfter: string | null;
}
export interface BatchStateEvent {
  runId: string; batchKey: string; stage: 'input_uploaded' | 'created' | 'polled'; rawReference: string;
  fileId?: string; requestCount?: number; inputBytes?: number; snapshot?: BatchSnapshot;
}
export interface BatchDependencies extends Pick<TransportDependencies, 'fetch' | 'guard' | 'readSecret' | 'now' | 'attemptId' | 'persistRaw' | 'logCall'> {
  persistBatchState(event: BatchStateEvent): Promise<void>;
  persistChunk(chunk: { retrievalId: string; fileId: string; index: number; bytes: Uint8Array }): Promise<void>;
  /** Stage immutable results only: do not decide documents until correlation has completed. */
  stageResult(value: { customId: string; result: BatchResult; source: { retrievalId: string; fileId: string; lineNumber: number } }): Promise<string>;
}
export class BatchReadRateLimitFailure extends ValidationFailure {
  readonly retryAfter: string | null;
  readonly rawReference: string;
  constructor(retryAfter: string | null, rawReference: string) { super('E_BATCH_READ_RATE_LIMIT', 'blocker', 'Batch GET was temporarily rate limited after its response was retained.'); this.retryAfter = retryAfter; this.rawReference = rawReference; }
}
export interface BatchCorrelation {
  /** This means every expected ID has a result or explicit failure, NOT that every document succeeded. */
  correlationComplete: true;
  results: { customId: string; reference: string }[];
  failures: { customId: string; code: string; detail: string; reference?: string }[];
  retrievalIds: string[];
}
const encoder = new TextEncoder();
const permanentOpenAiQuotaCodes = new Set(['insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded']);
const temporaryOpenAiRateLimitCodes = new Set(['rate_limit_exceeded', 'slow_down']);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(code: string, message: string): never { throw new ValidationFailure(code, 'blocker', message); }
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value)) fail('E_BATCH_ID', 'Batch or file identifier is invalid.');
}
function validateIO(io: BatchIOPolicy): void {
  for (const value of [io.maxMetadataBytes, io.maxResultLineBytes, io.streamChunkBytes]) if (!Number.isSafeInteger(value) || value < 1) fail('E_BATCH_IO_POLICY', 'Batch stream limits must be explicit positive integers.');
  if (io.streamChunkBytes > 1048576 || io.maxMetadataBytes > 16777216 || io.maxResultLineBytes > 33554432) fail('E_BATCH_IO_POLICY', 'Batch stream limits exceed bounded-memory limits.');
}
function validateContext(context: BatchContext): void {
  if (!context.runId || !context.batchKey) fail('E_BATCH_CONTEXT', 'Run and batch identities are required.');
  verifyModelPolicy(context.modelPolicy, context.modelPolicy.id, 'reader');
}
export function validateBatchInput(entries: readonly BatchInputEntry[], context: BatchContext, maxBytes = BATCH_MAX_INPUT_BYTES): { requestCount: number; inputBytes: number } {
  validateContext(context);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > BATCH_MAX_INPUT_BYTES) fail('E_BATCH_INPUT_LIMIT', 'Batch byte limit exceeds the published maximum.');
  if (entries.length < 1 || entries.length > BATCH_MAX_REQUESTS) fail('E_BATCH_INPUT_LIMIT', 'A Batch must contain 1 to 50,000 requests.');
  const ids = new Set<string>(); let inputBytes = 0;
  for (const entry of entries) {
    if (ids.has(entry.customId)) fail('E_BATCH_INPUT', 'Batch contains a duplicate custom identifier.');
    ids.add(entry.customId);
    if (entry.request.role !== 'reader' || entry.request.model !== context.modelPolicy.id || entry.request.modelPolicy.policy !== context.modelPolicy.policy) fail('E_BATCH_MODEL', 'Batch requests must share the configured reader model and policy.');
    inputBytes += encoder.encode(batchJsonl([entry]) + '\n').byteLength;
    if (inputBytes > maxBytes) fail('E_BATCH_INPUT_LIMIT', 'Batch input exceeds its UTF-8 byte limit.');
  }
  return { requestCount: entries.length, inputBytes };
}
async function persistRaw(deps: BatchDependencies, raw: RawAttempt): Promise<void> {
  try { await deps.persistRaw(raw); }
  catch { fail('E_RAW_PERSIST', 'Raw Batch response could not be stored.'); }
}
async function chunk(deps: BatchDependencies, retrievalId: string, fileId: string, index: number, bytes: Uint8Array): Promise<void> {
  try { await deps.persistChunk({ retrievalId, fileId, index, bytes: bytes.slice() }); }
  catch { fail('E_RAW_PERSIST', 'Raw Batch response chunk could not be stored.'); }
}
async function* persistedChunks(response: Response, retrievalId: string, fileId: string, deps: BatchDependencies, io: BatchIOPolicy): AsyncGenerator<Uint8Array> {
  if (!response.body) fail('E_BATCH_BODY', 'Batch response has no readable body.');
  const reader = response.body.getReader(); let index = 0; let complete = false;
  try {
    while (true) {
      await deps.guard('reader');
      let next: ReadableStreamReadResult<Uint8Array>;
      try { next = await reader.read(); }
      catch { fail('E_BATCH_RESPONSE_INTERRUPTED', 'Batch response stream was interrupted; no complete result was recorded.'); }
      if (next.done) { complete = true; return; }
      for (let offset = 0; offset < next.value.byteLength; offset += io.streamChunkBytes) {
        const bytes = next.value.subarray(offset, offset + io.streamChunkBytes);
        await chunk(deps, retrievalId, fileId, index++, bytes);
        yield bytes;
      }
    }
  } finally {
    if (!complete) {
      try { await reader.cancel(); }
      catch { /* The original typed stream/storage/guard failure is retained; cancellation is best effort. */ }
    }
    reader.releaseLock();
  }
}
async function fetchOnce(url: string, init: RequestInit, context: BatchContext, deps: BatchDependencies): Promise<{ response: Response; attempt: RawAttempt; start: number }> {
  await deps.guard('reader');
  let secret: string | null;
  try { secret = await deps.readSecret('reader'); }
  catch { fail('E_VENDOR_KEY', 'Reader credentials could not be read.'); }
  if (!secret || !secret.trim()) fail('E_VENDOR_KEY', 'Reader credentials are missing.');
  const attemptId = deps.attemptId(); id(attemptId);
  const start = deps.now();
  let response: Response;
  try { response = await deps.fetch(url, { ...init, redirect: 'manual', headers: { ...Object.fromEntries(new Headers(init.headers).entries()), authorization: `Bearer ${secret}` } }); }
  catch {
    await persistRaw(deps, { attemptId, role: 'reader', modelRequested: context.modelPolicy.id, status: null, requestId: null, raw: null, networkFailure: true, latencyMs: deps.now() - start, retryAfter: null });
    await deps.logCall({ attemptId, role: 'reader', modelRequested: context.modelPolicy.id, status: null, requestId: null, networkFailure: true, latencyMs: deps.now() - start, modelReturned: null, usage: null });
    fail(init.method === 'POST' ? 'E_BATCH_SUBMISSION_UNCERTAIN' : 'E_BATCH_NETWORK', 'Batch request did not return a response; it has not been automatically retried.');
  }
  return { response, start, attempt: { attemptId, role: 'reader', modelRequested: context.modelPolicy.id, status: response.status,
    requestId: response.headers.get('x-request-id'), raw: null, networkFailure: false, latencyMs: deps.now() - start, retryAfter: response.headers.get('retry-after') } };
}
async function requestJson(url: string, init: RequestInit, context: BatchContext, deps: BatchDependencies, io: BatchIOPolicy): Promise<{ value: unknown; rawReference: string; retryAfter: string | null }> {
  validateIO(io); validateContext(context);
  const { response, attempt, start } = await fetchOnce(url, init, context, deps);
  let raw = '', total = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  for await (const bytes of persistedChunks(response, attempt.attemptId, 'metadata', deps, io)) {
    total += bytes.byteLength;
    if (total > io.maxMetadataBytes) fail('E_BATCH_METADATA_LIMIT', 'Batch metadata response exceeds the configured limit.');
    try { raw += decoder.decode(bytes, { stream: true }); }
    catch { fail('E_BATCH_UTF8', 'Batch metadata is not valid UTF-8.'); }
  }
  try { raw += decoder.decode(); }
  catch { fail('E_BATCH_UTF8', 'Batch metadata ends with incomplete UTF-8.'); }
  await persistRaw(deps, { ...attempt, raw, latencyMs: deps.now() - start });
  await deps.logCall({ attemptId: attempt.attemptId, role: 'reader', modelRequested: context.modelPolicy.id, status: attempt.status,
    requestId: attempt.requestId, networkFailure: false, latencyMs: deps.now() - start, modelReturned: null, usage: null });
  let error: Record<string, unknown> | null = null;
  try { const value: unknown = JSON.parse(raw); if (record(value) && record(value.error)) error = value.error; }
  catch { /* A malformed error response remains a terminal Batch HTTP failure. */ }
  if (response.status === 429 && typeof error?.code === 'string' && permanentOpenAiQuotaCodes.has(error.code)) fail('E_OPENAI_QUOTA', 'OpenAI quota or billing access requires action before another request.');
  if ((init.method ?? 'GET') === 'GET' && response.status === 429 && typeof error?.code === 'string' && temporaryOpenAiRateLimitCodes.has(error.code)) throw new BatchReadRateLimitFailure(attempt.retryAfter, attempt.attemptId);
  if (response.status >= 300 && response.status < 400) fail('E_VENDOR_REDIRECT', 'Batch redirects are not followed. The unchanged response was retained.');
  if (response.status === 401 || response.status === 403) fail('E_VENDOR_AUTH', 'Reader credentials were rejected.');
  if (!response.ok) fail('E_BATCH_HTTP', 'Batch API request failed; the recorded response has not been automatically retried.');
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { fail('E_BATCH_SCHEMA', 'Batch API response is not valid JSON.'); }
  return { value, rawReference: attempt.attemptId, retryAfter: attempt.retryAfter };
}
function multipart(entries: readonly BatchInputEntry[], boundary: string): ReadableStream<Uint8Array> {
  let index = -1;
  return new ReadableStream({ pull(controller) {
    if (index === -1) {
      controller.enqueue(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nbatch\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="batch-input.jsonl"\r\nContent-Type: application/jsonl\r\n\r\n`)); index = 0;
    } else if (index < entries.length) controller.enqueue(encoder.encode(batchJsonl([entries[index++]]) + '\n'));
    else { controller.enqueue(encoder.encode(`\r\n--${boundary}--\r\n`)); controller.close(); }
  } });
}
export async function uploadBatchInput(entries: readonly BatchInputEntry[], context: BatchContext, deps: BatchDependencies, io: BatchIOPolicy): Promise<{ fileId: string; requestCount: number; inputBytes: number }> {
  const captured = entries.map(entry => ({ customId: entry.customId, request: Object.freeze({ ...entry.request, modelPolicy: Object.freeze({ ...entry.request.modelPolicy }) }) }));
  const summary = validateBatchInput(captured, context);
  const boundaryId = deps.attemptId(); id(boundaryId);
  const boundary = `batch-${boundaryId}`;
  const { value, rawReference } = await requestJson('https://api.openai.com/v1/files', { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body: multipart(captured, boundary) }, context, deps, io);
  if (!record(value) || value.purpose !== 'batch') fail('E_BATCH_FILE_SCHEMA', 'Uploaded Batch file response is invalid.');
  id(value.id);
  await deps.persistBatchState({ runId: context.runId, batchKey: context.batchKey, stage: 'input_uploaded', rawReference, fileId: value.id, ...summary });
  return { fileId: value.id, ...summary };
}
function snapshot(value: unknown, rawReference: string, retryAfter: string | null): BatchSnapshot {
  const statuses: string[] = ['validating', 'failed', 'in_progress', 'finalizing', 'completed', 'expired', 'cancelling', 'cancelled'];
  if (!record(value) || !statuses.includes(String(value.status)) || value.endpoint !== '/v1/responses' || value.completion_window !== '24h') fail('E_BATCH_SCHEMA', 'Batch status response is invalid.');
  id(value.id); id(value.input_file_id);
  for (const file of [value.output_file_id, value.error_file_id]) if (file !== null) id(file);
  if (!record(value.request_counts) || !['total', 'completed', 'failed'].every(key => Number.isSafeInteger(value.request_counts && (value.request_counts as Record<string, unknown>)[key]) && Number((value.request_counts as Record<string, unknown>)[key]) >= 0)) fail('E_BATCH_SCHEMA', 'Batch request counts are invalid.');
  return { id: value.id, inputFileId: value.input_file_id, status: value.status as BatchStatus, outputFileId: value.output_file_id as string | null,
    errorFileId: value.error_file_id as string | null, requestCounts: { total: Number(value.request_counts.total), completed: Number(value.request_counts.completed), failed: Number(value.request_counts.failed) }, rawReference, retryAfter };
}
export async function createBatch(inputFileId: string, context: BatchContext, deps: BatchDependencies, io: BatchIOPolicy): Promise<BatchSnapshot> {
  id(inputFileId);
  const result = await requestJson('https://api.openai.com/v1/batches', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input_file_id: inputFileId, endpoint: '/v1/responses', completion_window: '24h', metadata: { run_id: context.runId, batch_key: context.batchKey } }) }, context, deps, io);
  const state = snapshot(result.value, result.rawReference, result.retryAfter);
  if (state.inputFileId !== inputFileId) fail('E_BATCH_ID', 'Created Batch refers to a different input file.');
  await deps.persistBatchState({ runId: context.runId, batchKey: context.batchKey, stage: 'created', rawReference: result.rawReference, snapshot: state });
  return state;
}
export async function pollBatch(batchId: string, context: BatchContext, deps: BatchDependencies, io: BatchIOPolicy): Promise<BatchSnapshot> {
  id(batchId);
  const result = await requestJson(`https://api.openai.com/v1/batches/${batchId}`, { method: 'GET' }, context, deps, io);
  const state = snapshot(result.value, result.rawReference, result.retryAfter);
  if (state.id !== batchId) fail('E_BATCH_ID', 'Batch poll returned a different identity.');
  await deps.persistBatchState({ runId: context.runId, batchKey: context.batchKey, stage: 'polled', rawReference: result.rawReference, snapshot: state });
  return state;
}
export async function ingestBatchResults(state: BatchSnapshot, expectedIds: readonly string[], context: BatchContext, deps: BatchDependencies, io: BatchIOPolicy): Promise<BatchCorrelation> {
  validateContext(context); validateIO(io);
  if (!['completed', 'failed', 'expired', 'cancelled'].includes(state.status)) fail('E_BATCH_NOT_TERMINAL', 'Only terminal Batch results may be ingested.');
  const expected = new Set(expectedIds);
  if (expected.size !== expectedIds.length || expectedIds.some(value => !value) || expected.size > BATCH_MAX_REQUESTS) fail('E_BATCH_INPUT', 'Expected Batch identifiers must be unique and nonempty.');
  const results = new Map<string, string>(), failures = new Map<string, BatchCorrelation['failures'][number]>(), seen = new Set<string>();
  const retrievalIds: string[] = [];
  let classificationFailure:ValidationFailure|undefined;
  for (const fileId of new Set([state.outputFileId, state.errorFileId].filter((value): value is string => value !== null))) {
    id(fileId);
    const { response, attempt, start } = await fetchOnce(`https://api.openai.com/v1/files/${fileId}/content`, { method: 'GET' }, context, deps);
    retrievalIds.push(attempt.attemptId);
    await persistRaw(deps, attempt);
    if (!response.ok) {
      let total = 0;
      for await (const bytes of persistedChunks(response, attempt.attemptId, fileId, deps, io)) {
        total += bytes.byteLength;
        if (total > io.maxMetadataBytes) fail('E_BATCH_METADATA_LIMIT', 'Batch error response exceeds the configured limit.');
      }
      await deps.logCall({ attemptId: attempt.attemptId, role: 'reader', modelRequested: context.modelPolicy.id, status: attempt.status, requestId: attempt.requestId,
        networkFailure: false, latencyMs: deps.now() - start, modelReturned: null, usage: null });
      fail(response.status >= 300 && response.status < 400 ? 'E_VENDOR_REDIRECT' : response.status === 401 || response.status === 403 ? 'E_VENDOR_AUTH' : 'E_BATCH_HTTP', 'Batch result file could not be retrieved.');
    }
    let carry = '', lineNumber = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
    const handleLine = async (line: string) => {
      lineNumber++;
      try {
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.length === 0) fail('E_BATCH_RESULT', 'Batch output contains an empty result line.');
      if (encoder.encode(line).byteLength > io.maxResultLineBytes) fail('E_BATCH_RESULT_LIMIT', 'Batch result line exceeds the configured memory limit.');
      let envelope: unknown;
      try { envelope = JSON.parse(line); }
      catch { fail('E_BATCH_RESULT', 'Batch output contains invalid JSON.'); }
      if (!record(envelope) || typeof envelope.custom_id !== 'string' || !expected.has(envelope.custom_id)) fail('E_BATCH_RESULT', 'Batch output has an unexpected identifier.');
      const customId = envelope.custom_id;
      const result = parseBatchResults(line, [customId])[0];
      const reference = await deps.stageResult({ customId, result, source: { retrievalId: attempt.attemptId, fileId, lineNumber } });
      if (!reference) fail('E_BATCH_PERSIST', 'Batch result was not durably staged.');
      if (result.response && record(result.response.body) && Object.hasOwn(result.response.body, 'model')) verifyModelPolicy(context.modelPolicy, result.response.body.model, 'reader');
      if (result.response?.status_code === 401 || result.response?.status_code === 403) fail('E_VENDOR_AUTH', 'Reader credentials were rejected within the Batch.');
      const bodyError = result.response && record(result.response.body) && record(result.response.body.error) ? result.response.body.error : null;
      if (result.response?.status_code === 404 || bodyError?.code === 'model_not_found' || bodyError?.param === 'model') fail('E_MODEL_REJECTED', 'Configured reader model was rejected within the Batch.');
      if (seen.has(customId)) {
        results.delete(customId); failures.set(customId, { customId, code: 'E_BATCH_DUPLICATE_RESULT', detail: 'Multiple Batch results matched this document.', reference });
      } else if (result.error !== null && result.error !== undefined || result.response === null || result.response.status_code < 200 || result.response.status_code >= 300) {
        failures.set(customId, { customId, code: 'E_BATCH_DOCUMENT', detail: 'The vendor reported a Batch error for this document.', reference });
      } else results.set(customId, reference);
      seen.add(customId);
      } catch(error) {
        if(!(error instanceof ValidationFailure)||['E_RAW_PERSIST','E_BATCH_PERSIST'].includes(error.code))throw error;
        classificationFailure??=error;
      }
    };
    for await (const bytes of persistedChunks(response, attempt.attemptId, fileId, deps, io)) {
      try { carry += decoder.decode(bytes, { stream: true }); }
      catch { fail('E_BATCH_UTF8', 'Batch output is not valid UTF-8.'); }
      let newline: number;
      while ((newline = carry.indexOf('\n')) >= 0) { await handleLine(carry.slice(0, newline)); carry = carry.slice(newline + 1); }
      if (encoder.encode(carry).byteLength > io.maxResultLineBytes) fail('E_BATCH_RESULT_LIMIT', 'Batch result line exceeds the configured memory limit.');
    }
    try { carry += decoder.decode(); }
    catch { fail('E_BATCH_UTF8', 'Batch output ends with incomplete UTF-8.'); }
    if (carry.length) await handleLine(carry);
    await deps.logCall({ attemptId: attempt.attemptId, role: 'reader', modelRequested: context.modelPolicy.id, status: attempt.status, requestId: attempt.requestId,
      networkFailure: false, latencyMs: deps.now() - start, modelReturned: null, usage: null });
  }
  for (const customId of expected) if (!seen.has(customId)) failures.set(customId, { customId,
    code: state.status === 'expired' ? 'E_BATCH_EXPIRED' : state.status === 'cancelled' ? 'E_BATCH_CANCELLED' : state.status === 'failed' ? 'E_BATCH_FAILED' : 'E_BATCH_MISSING_RESULT',
    detail: 'No result was returned for this expected document.' });
  await deps.guard('reader');
  if(classificationFailure)throw classificationFailure;
  return { correlationComplete: true, results: [...results].map(([customId, reference]) => ({ customId, reference })), failures: [...failures.values()], retrievalIds };
}
