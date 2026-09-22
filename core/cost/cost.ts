/** Monetary values are integer nanodollars represented as decimal strings at storage boundaries. */
export interface Rational { numerator: string; denominator: string }
export interface TokenRates {
  inputNanodollarsPerMillion: string;
  outputNanodollarsPerMillion: string;
  longContext?: { aboveInputTokens: number; inputMultiplier: Rational; outputMultiplier: Rational };
}
export interface CallTokens {
  /** Includes instructions, taxonomy and every other billed input token. */
  inputTokens: number;
  maxOutputTokens: number;
  measuredExpectedOutputTokens?: number;
}
export interface CostDocument { id: string; confidence: CallTokens; reader: CallTokens; recovery: CallTokens | null }
export interface CostAttempts { confidence: number; recovery: number; readerTransport: number; readerSchema: number }
export interface CostInput {
  documents: readonly CostDocument[];
  rates: { confidence: TokenRates; reader: TokenRates; recovery: TokenRates };
  /** Must be the same explicit maximums enforced by vendor execution. */
  attempts: CostAttempts;
}
export interface CostEstimate {
  worstCaseNanodollars: string;
  estimateNanodollars: string;
  estimateBasis: 'one_attempt_output_caps' | 'one_attempt_measured_outputs_and_caps';
  documents: { id: string; worstCaseNanodollars: string; estimateNanodollars: string; readerAttempts: number }[];
  attempts: CostAttempts;
}
function money(value: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Money must be a nonnegative integer nanodollar string.');
  return BigInt(value);
}
function count(value: number, label: string, minimum = 0): bigint {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${label} count.`);
  return BigInt(value);
}
function ratio(value: Rational): [bigint, bigint] {
  const numerator = money(value.numerator), denominator = money(value.denominator);
  if (denominator === 0n || numerator === 0n) throw new Error('Rate multipliers must be positive.');
  return [numerator, denominator];
}
const ceil = (numerator: bigint, denominator: bigint) => (numerator + denominator - 1n) / denominator;
function callCost(tokens: CallTokens, rates: TokenRates, estimate: boolean): bigint {
  const input = count(tokens.inputTokens, 'input token');
  const cap = count(tokens.maxOutputTokens, 'maximum output token');
  let output = cap;
  if (tokens.measuredExpectedOutputTokens !== undefined) {
    const expected = count(tokens.measuredExpectedOutputTokens, 'measured output token');
    if (expected > cap) throw new Error('Measured expected output exceeds the output cap.');
    if (estimate) output = expected;
  }
  let inputMultiplier: [bigint, bigint] = [1n, 1n], outputMultiplier: [bigint, bigint] = [1n, 1n];
  if (rates.longContext) {
    count(rates.longContext.aboveInputTokens, 'long-context input token');
    const configuredInput = ratio(rates.longContext.inputMultiplier), configuredOutput = ratio(rates.longContext.outputMultiplier);
    if (tokens.inputTokens > rates.longContext.aboveInputTokens) {
      inputMultiplier = configuredInput;
      outputMultiplier = configuredOutput;
    }
  }
  return ceil(input * money(rates.inputNanodollarsPerMillion) * inputMultiplier[0], 1000000n * inputMultiplier[1]) +
    ceil(output * money(rates.outputNanodollarsPerMillion) * outputMultiplier[0], 1000000n * outputMultiplier[1]);
}

export function estimateRunCost(input: CostInput): CostEstimate {
  const attempts = input.attempts;
  const confidenceAttempts = count(attempts.confidence, 'confidence attempt', 1);
  const recoveryAttempts = count(attempts.recovery, 'recovery attempt', 1);
  const readerAttempts = count(attempts.readerTransport, 'reader transport attempt', 1) * count(attempts.readerSchema, 'reader schema attempt', 1);
  if (readerAttempts > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Reader attempt count exceeds supported range.');
  const ids = new Set<string>();
  let measured = false, worst = 0n, estimated = 0n;
  const documents = input.documents.map(document => {
    if (!document.id || ids.has(document.id)) throw new Error('Missing or duplicate cost document identity.');
    ids.add(document.id);
    if (document.recovery === undefined) throw new Error('Recovery costs must be explicitly provided or null.');
    const calls = [document.confidence, document.reader, ...(document.recovery ? [document.recovery] : [])];
    measured ||= calls.some(call => call.measuredExpectedOutputTokens !== undefined);
    const ceiling = callCost(document.confidence, input.rates.confidence, false) * confidenceAttempts +
      callCost(document.reader, input.rates.reader, false) * readerAttempts +
      (document.recovery ? callCost(document.recovery, input.rates.recovery, false) * recoveryAttempts : 0n);
    const estimate = callCost(document.confidence, input.rates.confidence, true) + callCost(document.reader, input.rates.reader, true) +
      (document.recovery ? callCost(document.recovery, input.rates.recovery, true) : 0n);
    worst += ceiling;
    estimated += estimate;
    return { id: document.id, worstCaseNanodollars: ceiling.toString(), estimateNanodollars: estimate.toString(), readerAttempts: Number(readerAttempts) };
  });
  return { worstCaseNanodollars: worst.toString(), estimateNanodollars: estimated.toString(),
    estimateBasis: measured ? 'one_attempt_measured_outputs_and_caps' : 'one_attempt_output_caps', documents, attempts: { ...attempts } };
}

export interface BudgetDecision {
  status: 'allowed' | 'refused';
  ceilingNanodollars: string;
  projectLimitNanodollars: string;
  limitNanodollars: string | null;
  override: boolean;
  actor: string;
  timestamp: string;
}
/** Persist this complete record before permitting upload or execution. */
export function authorizeBudget(input: Omit<BudgetDecision, 'status' | 'limitNanodollars'>): BudgetDecision {
  const ceiling = money(input.ceilingNanodollars), limit = money(input.projectLimitNanodollars);
  if (!input.actor.trim()) throw new Error('Budget decision actor is required.');
  if (!input.timestamp || !Number.isFinite(Date.parse(input.timestamp))) throw new Error('Budget decision timestamp is required.');
  if (typeof input.override !== 'boolean') throw new Error('Budget override must be explicit.');
  return { ...input, status: input.override || ceiling <= limit ? 'allowed' : 'refused', limitNanodollars: input.override ? null : input.projectLimitNanodollars };
}
export function checkLiveBudget(decision: BudgetDecision, actualNanodollars: string): { halt: boolean; reason: 'budget_refused' | 'budget_exceeded' | null } {
  const actual = money(actualNanodollars);
  if (decision.status === 'refused') return { halt: true, reason: 'budget_refused' };
  if ((decision.override && decision.limitNanodollars !== null) || (!decision.override && decision.limitNanodollars === null)) throw new Error('Inconsistent persisted budget decision.');
  if (decision.limitNanodollars !== null && actual > money(decision.limitNanodollars)) return { halt: true, reason: 'budget_exceeded' };
  return { halt: false, reason: null };
}

export class UsageAccountingFailure extends Error {
  readonly code: 'E_VENDOR_USAGE' | 'E_CACHE_POLICY';
  readonly kind = 'blocker' as const;
  constructor(code: 'E_VENDOR_USAGE' | 'E_CACHE_POLICY', message: string) { super(message); this.name = 'UsageAccountingFailure'; this.code = code; }
}
/**
 * Price recorded token usage, never estimated output. Terra/Luna callers use
 * disabled: their request contains explicit cache mode and zero breakpoints.
 * Jev callers use not_applicable, as its usage contract has no cache tiers.
 * Persist raw usage (and a null-cost audit row on failure) before calling this.
 */
export function actualUsageCost(usage: unknown, rates: TokenRates, cachePolicy: 'disabled' | 'not_applicable'): string {
  const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (!isRecord(usage) || !isCount(usage.input_tokens) || !isCount(usage.output_tokens)) {
    throw new UsageAccountingFailure('E_VENDOR_USAGE', 'Vendor input and output token usage must be explicit nonnegative integers.');
  }
  if (cachePolicy === 'disabled') {
    const details = usage.input_tokens_details;
    if (!isRecord(details) || !isCount(details.cached_tokens) || !isCount(details.cache_write_tokens) || details.cached_tokens !== 0 || details.cache_write_tokens !== 0) {
      throw new UsageAccountingFailure('E_CACHE_POLICY', 'The no-cache request requires explicit zero cache read and write tokens; billed usage is unaccounted until reconciled.');
    }
  } else if (cachePolicy !== 'not_applicable') {
    throw new UsageAccountingFailure('E_CACHE_POLICY', 'An explicit vendor cache accounting policy is required.');
  }
  return callCost({ inputTokens: usage.input_tokens, maxOutputTokens: usage.output_tokens }, rates, false).toString();
}
