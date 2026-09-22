import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateRunCost, authorizeBudget, checkLiveBudget, actualUsageCost, type CostInput } from './cost.ts';
const rate = { inputNanodollarsPerMillion: '2000000000', outputNanodollarsPerMillion: '10000000000' };
const input: CostInput = {
  documents: [{ id: '1', confidence: { inputTokens: 100, maxOutputTokens: 0 }, reader: { inputTokens: 1000, maxOutputTokens: 100 }, recovery: { inputTokens: 200, maxOutputTokens: 50 } }],
  rates: { confidence: rate, reader: rate, recovery: rate },
  attempts: { confidence: 3, recovery: 3, readerTransport: 3, readerSchema: 2 },
};

test('ceiling includes every permitted confidence, recovery and reader attempt', () => {
  const result = estimateRunCost(input);
  assert.equal(result.worstCaseNanodollars, '21300000');
  assert.equal(result.estimateNanodollars, '4100000');
  assert.equal(result.estimateBasis, 'one_attempt_output_caps');
  assert.equal(result.documents[0].readerAttempts, 6);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('long input tier reprices full input and output only strictly above threshold', () => {
  const base = { ...input, documents: [{ id: '1', confidence: { inputTokens: 0, maxOutputTokens: 0 }, reader: { inputTokens: 272000, maxOutputTokens: 100 }, recovery: null }],
    rates: { ...input.rates, reader: { ...rate, longContext: { aboveInputTokens: 272000, inputMultiplier: { numerator: '2', denominator: '1' }, outputMultiplier: { numerator: '3', denominator: '2' } } } } };
  assert.equal(estimateRunCost(base).worstCaseNanodollars, '3270000000');
  base.documents[0].reader.inputTokens++;
  assert.equal(estimateRunCost(base).worstCaseNanodollars, '6537024000');
});

test('fractional nanodollar costs round upward and measured estimate is explicitly labelled', () => {
  const value = estimateRunCost({ ...input, documents: [{ id: '1', confidence: { inputTokens: 1, maxOutputTokens: 0 }, reader: { inputTokens: 0, maxOutputTokens: 0, measuredExpectedOutputTokens: 0 }, recovery: null }],
    rates: { ...input.rates, confidence: { inputNanodollarsPerMillion: '1', outputNanodollarsPerMillion: '0' } } });
  assert.equal(value.worstCaseNanodollars, '3');
  assert.equal(value.estimateNanodollars, '1');
  assert.equal(value.estimateBasis, 'one_attempt_measured_outputs_and_caps');
});

test('no recovery costs when explicitly absent; missing attempts and invalid counts fail', () => {
  assert.equal(estimateRunCost({ ...input, documents: [{ ...input.documents[0], recovery: null }] }).worstCaseNanodollars, '18600000');
  assert.throws(() => estimateRunCost({ ...input, attempts: { ...input.attempts, readerTransport: 0 } }), /attempt/);
  assert.throws(() => estimateRunCost({ ...input, documents: [{ ...input.documents[0], reader: { inputTokens: -1, maxOutputTokens: 1 } }] }), /token/);
});

test('budget equality allowed, excess refused, explicit override records no limit with actor and time', () => {
  const audit = { actor: 'owner', timestamp: '2026-09-22T00:00:00Z' };
  assert.equal(authorizeBudget({ ceilingNanodollars: '100', projectLimitNanodollars: '100', override: false, ...audit }).status, 'allowed');
  assert.equal(authorizeBudget({ ceilingNanodollars: '101', projectLimitNanodollars: '100', override: false, ...audit }).status, 'refused');
  const decision = authorizeBudget({ ceilingNanodollars: '101', projectLimitNanodollars: '100', override: true, ...audit });
  assert.equal(decision.limitNanodollars, null);
  assert.equal(decision.actor, audit.actor);
  assert.equal(decision.timestamp, audit.timestamp);
  assert.equal(checkLiveBudget(decision, '999999').halt, false);
  const limited = authorizeBudget({ ceilingNanodollars: '100', projectLimitNanodollars: '100', override: false, ...audit });
  assert.equal(checkLiveBudget(limited, '100').halt, false);
  assert.equal(checkLiveBudget(limited, '101').halt, true);
  assert.throws(() => authorizeBudget({ ceilingNanodollars: '101', projectLimitNanodollars: '100', override: true, actor: '', timestamp: audit.timestamp }), /actor/);
});

test('actual usage under disabled caching validates explicit zero cache counters and charges returned tokens', () => {
  const usage = { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } };
  assert.equal(actualUsageCost(usage, rate, 'disabled'), '3000000');
  assert.equal(actualUsageCost({ input_tokens: 1000, output_tokens: 100 }, rate, 'not_applicable'), '3000000');
  for (const details of [undefined, { cached_tokens: 0 }, { cached_tokens: 1, cache_write_tokens: 0 }, { cached_tokens: 0, cache_write_tokens: 1 }]) {
    assert.throws(() => actualUsageCost({ ...usage, input_tokens_details: details }, rate, 'disabled'), (error: unknown) => (error as { code: string }).code === 'E_CACHE_POLICY');
  }
  assert.throws(() => actualUsageCost({ ...usage, input_tokens: -1 }, rate, 'disabled'), /token/i);
});
