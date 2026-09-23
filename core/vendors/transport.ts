import { verifyModelPolicy, type FrozenVendorRequest, type VendorRole, type ReaderEvaluationPolicy } from './requests.ts';
import { ValidationFailure } from './validate.ts';

export interface RetryPolicy {
  transportAttempts: number;
  schemaAttempts: number;
  baseDelayMs: number;
  maxBackoffMs: number;
  consecutiveFailureLimit: number;
}
export interface RawAttempt {
  attemptId: string;
  role: VendorRole;
  modelRequested: string;
  status: number | null;
  requestId: string | null;
  raw: string | null;
  networkFailure: boolean;
  latencyMs: number;
  retryAfter: string | null;
}
export interface CallLog extends Omit<RawAttempt, 'raw' | 'retryAfter'> {
  modelReturned: string | null;
  usage: Record<string, unknown> | null;
}
export interface TransportDependencies {
  /** Optional shared backpressure; must not allocate an inference attempt while waiting. */
  awaitAdmission?(role:VendorRole,model:string):Promise<void>;
  /** Called only for explicit temporary429 hints after immutable raw and call logging. */
  observeRetryAfter?(attempt:RawAttempt):Promise<void>;
  fetch(url: string, init: RequestInit): Promise<Response>;
  readSecret(role: VendorRole): Promise<string | null>;
  /** Must enforce live-call gate, kill switch and spending limit from persistent state. */
  guard(role: VendorRole): Promise<void>;
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  /** Fresh immutable artifact identity, including across resumed invocations. */
  attemptId(): string;
  persistRaw(attempt: RawAttempt): Promise<void>;
  logCall(call: CallLog): Promise<void>;
  /** Persist ordered document outcomes per vendor, reset on non-exhausted outcomes. */
  recordDocumentOutcome(role: VendorRole, exhausted: boolean): Promise<number>;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const permanentOpenAiQuotaCodes = new Set(['insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded']);
const tokenCount = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function schemaCode(role: VendorRole): string { return role === 'reader' ? 'E_READER_SCHEMA' : role === 'confidence' ? 'E_JEV_SCHEMA' : 'E_RECOVERY_SCHEMA'; }
function validatePolicy(policy: RetryPolicy, role: VendorRole): void {
  for (const value of [policy.transportAttempts, policy.schemaAttempts, policy.baseDelayMs, policy.maxBackoffMs, policy.consecutiveFailureLimit]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new ValidationFailure('E_RETRY_POLICY', 'blocker', 'Retry policy requires explicit positive integers.');
  }
  if (policy.transportAttempts > 3 || policy.schemaAttempts > (role === 'reader' ? 2 : 1) || policy.maxBackoffMs < policy.baseDelayMs) {
    throw new ValidationFailure('E_RETRY_POLICY', 'blocker', 'Retry policy exceeds the allowed attempt limits.');
  }
}
/** A vendor delay is a minimum; the exponential cap never truncates retry-after. */
export function retryDelay(header: string | null, attempt: number, policy: RetryPolicy, nowMs: number): number {
  const backoff = Math.min(policy.maxBackoffMs, policy.baseDelayMs * 2 ** (attempt - 1));
  if (header === null) return backoff;
  let required: number;
  if (/^\d+(?:\.\d+)?$/.test(header.trim())) required = Math.ceil(Number(header) * 1000);
  else {
    const date = Date.parse(header);
    if (!Number.isFinite(date)) throw new ValidationFailure('E_RETRY_AFTER', 'document', 'Vendor retry-after header is invalid.');
    required = Math.max(0, date - nowMs);
  }
  if (!Number.isSafeInteger(required) || required < 0) throw new ValidationFailure('E_RETRY_AFTER', 'document', 'Vendor retry-after delay is unsupported.');
  return Math.max(backoff, required);
}
async function exhausted(role: VendorRole, deps: TransportDependencies, policy: RetryPolicy, failure: ValidationFailure): Promise<never> {
  const consecutive = await deps.recordDocumentOutcome(role, true);
  if (!Number.isSafeInteger(consecutive) || consecutive < 0) throw new ValidationFailure('E_VENDOR_CIRCUIT_STATE', 'blocker', 'Vendor failure counter is invalid.');
  if (consecutive >= policy.consecutiveFailureLimit) throw new ValidationFailure('E_VENDOR_CIRCUIT', 'blocker', 'Consecutive documents exhausted vendor retries.');
  throw failure;
}

/** Bounded retries of the SAME immutable request bytes. No vendor is contacted except injected fetch. */
export async function executeVendor<T>(request: FrozenVendorRequest, policy: RetryPolicy, deps: TransportDependencies,
  decode: (raw: unknown) => T, evaluation?: ReaderEvaluationPolicy): Promise<{ value: T; attemptIds: string[] }> {
  evaluation = evaluation === undefined ? undefined : Object.freeze({ ...evaluation, models: Object.freeze([...evaluation.models]) });
  validatePolicy(policy, request.role);
  const endpoint = request.role === 'confidence' ? 'https://api.typesafe.ai/v1/systemone' : 'https://api.openai.com/v1/responses';
  if (request.endpoint !== endpoint) throw new ValidationFailure('E_VENDOR_ENDPOINT', 'blocker', 'Vendor endpoint differs from the permitted API.');
  // Capture primitive values once: caller mutation can never alter a retry.
  const { role, model, body } = request;
  const modelPolicy = { ...request.modelPolicy };
  if (modelPolicy.id !== model) throw new ValidationFailure('E_MODEL_POLICY', 'blocker', 'Request model and policy differ.');
  verifyModelPolicy(modelPolicy, model, role, evaluation);
  const attemptIds: string[] = [];
  for (let schemaAttempt = 1; schemaAttempt <= policy.schemaAttempts; schemaAttempt++) {
    for (let transportAttempt = 1; transportAttempt <= policy.transportAttempts; transportAttempt++) {
      await deps.guard(role);
      if(deps.awaitAdmission){await deps.awaitAdmission(role,model);await deps.guard(role);}
      let secret: string | null;
      try { secret = await deps.readSecret(role); }
      catch { throw new ValidationFailure('E_VENDOR_KEY', 'blocker', 'Vendor credentials could not be read.'); }
      if (!secret || !secret.trim()) throw new ValidationFailure('E_VENDOR_KEY', 'blocker', 'Vendor credentials are missing.');
      const attemptId = deps.attemptId();
      if (!attemptId || attemptIds.includes(attemptId)) throw new ValidationFailure('E_ATTEMPT_ID', 'blocker', 'A fresh vendor attempt identifier is required.');
      attemptIds.push(attemptId);
      const start = deps.now();
      let status: number | null = null, requestId: string | null = null, raw: string | null = null, retryAfter: string | null = null;
      let networkFailure = false;
      try {
        const response = await deps.fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body, redirect: 'manual' });
        status = response.status;
        requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id');
        retryAfter = response.headers.get('retry-after');
        raw = await response.text();
      } catch {
        // Network exceptions can include request credentials. Persist only this typed fact.
        networkFailure = true;
      }
      secret = null;
      const latencyMs = deps.now() - start;
      if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new ValidationFailure('E_CLOCK', 'blocker', 'Vendor timing source moved backwards.');
      const attempt: RawAttempt = { attemptId, role, modelRequested: model, status, requestId, raw, networkFailure, latencyMs, retryAfter };
      try { await deps.persistRaw(attempt); }
      catch { throw new ValidationFailure('E_RAW_PERSIST', 'blocker', 'Raw vendor response could not be stored.'); }
      let parsed: unknown = null, parseFailure = false;
      if (raw !== null) {
        try { parsed = JSON.parse(raw); }
        catch { parseFailure = true; /* Raw response remains immutable; malformed JSON is handled below. */ }
      }
      const modelReturned = record(parsed) && typeof parsed.model === 'string' ? parsed.model : null;
      const usage = record(parsed) && record(parsed.usage) ? parsed.usage : null;
      const { raw: _raw, retryAfter: _retryAfter, ...metadata } = attempt;
      try { await deps.logCall({ ...metadata, modelReturned, usage }); }
      catch { throw new ValidationFailure('E_VENDOR_LOG', 'blocker', 'Vendor call usage and event could not be stored.'); }
      const error = record(parsed) && record(parsed.error) ? parsed.error : null;
      if (modelReturned !== null) verifyModelPolicy(modelPolicy, modelReturned, role, evaluation);
      const permanentOpenAiQuota = role !== 'confidence' && status === 429 && typeof error?.code === 'string' && permanentOpenAiQuotaCodes.has(error.code);
      // No further inference is possible after this blocker, so preserve the provider diagnosis before the guard that stops new work on unknown usage.
      if (permanentOpenAiQuota) throw new ValidationFailure('E_OPENAI_QUOTA', 'blocker', 'OpenAI quota or billing access requires action before another request.');
      if(status===429&&retryAfter!==null&&deps.observeRetryAfter)await deps.observeRetryAfter(attempt);
      await deps.guard(role);
      if (networkFailure || status === 408 || status === 409 || status === 429 || status !== null && status >= 500) {
        if (transportAttempt === policy.transportAttempts) return exhausted(role, deps, policy, new ValidationFailure('E_VENDOR_UNAVAILABLE', 'document', 'Vendor unavailable after all permitted attempts.'));
        await deps.sleep(retryDelay(retryAfter, transportAttempt, policy, deps.now()));
        continue;
      }
      if (status !== null && status >= 300 && status < 400) {
        await deps.recordDocumentOutcome(role, false);
        throw new ValidationFailure('E_VENDOR_REDIRECT', 'document', 'Vendor redirects are not followed. The unchanged response was retained.');
      }
      if (status === 401 || status === 403) throw new ValidationFailure('E_VENDOR_AUTH', 'blocker', 'Vendor credentials were rejected.');
      if (status === 404 || error?.code === 'model_not_found' || error?.param === 'model') throw new ValidationFailure('E_MODEL_REJECTED', 'blocker', 'Configured model was rejected by the vendor.');
      if (status === null || status < 200 || status >= 300) {
        await deps.recordDocumentOutcome(role, false);
        throw new ValidationFailure(error?.code === 'context_length_exceeded' ? 'E_READER_CONTEXT' : 'E_VENDOR_REQUEST', 'document', 'Vendor rejected the unchanged request.');
      }
      let value: T;
      try {
        if (parseFailure || parsed === null) throw new ValidationFailure(schemaCode(role), 'document', 'Vendor response is not valid JSON.');
        // No silent omission of live spend on syntactically valid successful responses.
        if (!usage || !tokenCount(usage.input_tokens) || !tokenCount(usage.output_tokens)) throw new ValidationFailure('E_VENDOR_USAGE', 'blocker', 'Vendor token usage is missing or invalid.');
        value = decode(parsed);
      } catch (error) {
        if (!(error instanceof ValidationFailure)) throw error;
        if (error.kind === 'blocker') throw error;
        if (role === 'reader' && error.code === 'E_READER_SCHEMA') {
          if (schemaAttempt < policy.schemaAttempts) break;
          return exhausted(role, deps, policy, error);
        }
        await deps.recordDocumentOutcome(role, false);
        throw error;
      }
      await deps.recordDocumentOutcome(role, false);
      return { value, attemptIds };
    }
  }
  throw new ValidationFailure('E_RETRY_STATE', 'blocker', 'Vendor retry loop ended without an outcome.');
}
