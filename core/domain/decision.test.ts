import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, type DecisionInput } from './decision.ts';

const input = (overrides: Partial<DecisionInput> = {}): DecisionInput => ({
  typeIds: ['type_a', 'type_b'],
  threshold: 0.9,
  failures: [],
  notes: [],
  confidence: { choice: 'type_a', certainty: 0.9, noul: { type_a: 0.5, type_b: 0 } },
  readerYes: ['type_a'],
  ...overrides,
});

test('R0 precedes notes and agreement, preserving every failure', () => {
  const result = decide(input({ failures: ['E_ONE', 'E_TWO'], notes: ['N_ONE'], confidence: undefined, readerYes: undefined }));
  assert.deepEqual(result, { ruleId: 'R0', outcome: 'could_not_process', destinationFolder: 'could_not_process', reasonCode: 'stage_failed', failures: ['E_ONE', 'E_TWO'], notes: ['N_ONE'] });
});

test('R0n precedes agreement and needs no missing stage outputs', () => {
  const result = decide(input({ notes: ['N_ONE', 'N_TWO'], confidence: undefined, readerYes: undefined }));
  assert.equal(result.ruleId, 'R0n');
  assert.deepEqual(result.notes, ['N_ONE', 'N_TWO']);
  assert.equal(result.outcome, 'review');
});

test('R1 includes exact certainty and Noul boundaries', () => {
  for (const threshold of [0, 0.5, 0.9, 1]) {
    for (const noul of [0.5, 1]) {
      const result = decide(input({ threshold, confidence: { choice: 'type_a', certainty: threshold, noul: { type_a: noul, type_b: 1 } } }));
      assert.equal(result.ruleId, 'R1');
      assert.equal(result.typeId, 'type_a');
      assert.equal(result.destinationFolder, 'type_a');
      assert.equal(result.outcome, 'filed');
    }
  }
});

test('R2 requires agreement strictly below certainty threshold', () => {
  const result = decide(input({ confidence: { choice: 'type_a', certainty: 0.899999, noul: { type_a: 0.5, type_b: 0 } } }));
  assert.equal(result.ruleId, 'R2');
  assert.equal(result.reasonCode, 'low_certainty');
});

test('R3 takes precedence over disagreement for multiple reader yes values', () => {
  assert.equal(decide(input({ readerYes: ['type_a', 'type_b'] })).ruleId, 'R3');
  assert.equal(decide(input({ readerYes: ['type_a', 'type_b'], confidence: { choice: 'none_of_these', certainty: 0, noul: { type_a: 0, type_b: 0 } } })).ruleId, 'R3');
});

test('R4 requires none of these, no reader yes values, and all Nouls strictly below midpoint', () => {
  assert.equal(decide(input({ readerYes: [], confidence: { choice: 'none_of_these', certainty: 1, noul: { type_a: 0, type_b: 0.499999 } } })).ruleId, 'R4');
  assert.equal(decide(input({ readerYes: [], confidence: { choice: 'none_of_these', certainty: 1, noul: { type_a: 0, type_b: 0.5 } } })).ruleId, 'R5');
});

test('R5 disagreement receives priority one', () => {
  for (const overrides of [
    { readerYes: [] },
    { readerYes: ['type_b'] },
    { confidence: { choice: 'type_a', certainty: 1, noul: { type_a: 0.499999, type_b: 0 } } },
    { confidence: { choice: 'none_of_these', certainty: 1, noul: { type_a: 1, type_b: 1 } } },
  ]) {
    const result = decide(input(overrides));
    assert.equal(result.ruleId, 'R5');
    assert.equal(result.priority, 1);
    assert.equal(result.destinationFolder, 'human_review');
    assert.equal(result.typeId, undefined);
  }
});

test('malformed internal inputs fail loudly without inferring missing vendor data', () => {
  const cases: Partial<DecisionInput>[] = [
    { threshold: NaN }, { threshold: -1 }, { threshold: 1.01 },
    { typeIds: [] }, { typeIds: ['type_a', 'type_a'] }, { typeIds: ['none_of_these'] },
    { typeIds: ['human_review'] }, { typeIds: ['../type_a'] },
    { confidence: undefined }, { readerYes: undefined },
    { readerYes: ['type_a', 'type_a'] }, { readerYes: ['type_c'] },
    { confidence: { choice: 'type_c', certainty: 0.9, noul: { type_a: 1, type_b: 0 } } },
    { confidence: { choice: 'type_a', certainty: Infinity, noul: { type_a: 1, type_b: 0 } } },
    { confidence: { choice: 'type_a', certainty: 1, noul: { type_a: 1 } } },
    { confidence: { choice: 'type_a', certainty: 1, noul: { type_a: 1, type_b: -0.1 } } },
    { confidence: { choice: 'type_a', certainty: 1, noul: { type_a: 1, type_b: NaN } } },
    { confidence: { choice: 'type_a', certainty: 1, noul: { type_a: 1, type_b: 0, type_c: 0 } } },
    { failures: [''] }, { notes: [''] },
  ];
  for (const overrides of cases) assert.throws(() => decide(input(overrides)), /Invalid decision input/);
});

test('all combinations obey first-match rules deterministically without modifying input', () => {
  let combinations = 0;
  for (const failed of [false, true]) for (const noted of [false, true])
  for (const choice of ['type_a', 'type_b', 'none_of_these'])
  for (const certainty of [0, 0.899999, 0.9, 1])
  for (const a of [0, 0.499999, 0.5, 1]) for (const b of [0, 0.499999, 0.5, 1])
  for (const yes of [[], ['type_a'], ['type_b'], ['type_a', 'type_b']]) {
    const current = input({ failures: failed ? ['E_ONE'] : [], notes: noted ? ['N_ONE'] : [], confidence: { choice, certainty, noul: { type_a: a, type_b: b } }, readerYes: yes });
    const before = structuredClone(current);
    const agreed = yes.length === 1 && yes[0] === choice && (choice === 'type_a' ? a : b) >= 0.5;
    const expected = failed ? 'R0' : noted ? 'R0n' : agreed ? certainty >= 0.9 ? 'R1' : 'R2' : yes.length >= 2 ? 'R3' : yes.length === 0 && choice === 'none_of_these' && a < 0.5 && b < 0.5 ? 'R4' : 'R5';
    const first = decide(current);
    assert.equal(first.ruleId, expected);
    assert.deepEqual(decide(current), first);
    assert.deepEqual(current, before);
    assert.equal(first.outcome === 'filed', expected === 'R1');
    combinations++;
  }
  assert.equal(combinations, 3072);
});
