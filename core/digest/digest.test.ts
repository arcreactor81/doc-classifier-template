import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, DIGEST_POLICY_VERSION, type DigestInput, type DigestPolicy } from './digest.ts';
import { verifyRecoveredHeadings } from './recovery.ts';

const policy: DigestPolicy = { version: DIGEST_POLICY_VERSION, acceptedBy: 'test', acceptedAt: '2026-09-22', tokenizerId: 'test-codepoints' };
const codec = {
  id: 'test-codepoints',
  countTokens: (text: string) => Array.from(text).length,
  prefixWithinBudget(text: string, fits: (prefix: string) => boolean) {
    const chars = Array.from(text);
    for (let n = chars.length; n >= 0; n--) { const prefix = chars.slice(0, n).join(''); if (fits(prefix)) return prefix; }
    return '';
  },
};
const input: DigestInput = {
  headings: [{ id: 'a', text: 'Section A', level: 1, position: 0 }, { id: 'b', text: 'Method', level: 2, position: 30 }],
  tables: [{ position: 20, headers: ['Column A', 'Column B'] }],
  blocks: [{ position: 10, headingId: 'a', text: 'a'.repeat(80) }, { position: 40, headingId: 'b', text: 'b'.repeat(80) }],
};
const build = (data = input, budget = 10000, vocabulary = ['method']) => buildDigest(data, { budget, vocabulary, policy, codec });

test('digest deterministic and structural text selected first while outline remains ordered', () => {
  const result = build();
  assert.deepEqual(result, build());
  assert.deepEqual(result.state.headings, input.headings);
  assert.deepEqual(result.state.tables, input.tables);
  assert.deepEqual(result.state.sections.map(s => s.headingId), ['b', 'a']);
  assert.equal(result.selectionLog.filter(item => item.kind === 'heading').length, 2);
  assert.equal(result.tokenCount, codec.countTokens(result.serialized));
});

test('mandatory outline over budget fails without trimming', () => {
  assert.throws(() => build(input, 1), (error: unknown) => (error as { code: string }).code === 'E_DIGEST_OUTLINE_BUDGET');
});

test('budget covers full serialized state; all block omissions and trims are logged', () => {
  const baseline = build({ ...input, blocks: [] });
  const result = build(input, baseline.tokenCount + 60);
  assert.ok(result.tokenCount <= baseline.tokenCount + 60);
  assert.deepEqual(result.state.headings, input.headings);
  assert.deepEqual(result.state.tables, input.tables);
  const logs = result.selectionLog.filter(item => item.kind === 'block');
  assert.equal(logs.length, 2);
  assert.ok(logs.some(item => item.omittedCharacters > 0));
  assert.equal(result.state.sections[0].headingId, 'b');
});

test('title fallback and notes are explicit', () => {
  const result = build({ headings: [], tables: [], blocks: [{ position: 0, text: 'a' }, { position: 1, text: 'b' }] });
  assert.equal(result.state.title, 'a');
  assert.deepEqual(result.notes, ['N_NO_OUTLINE']);
  assert.deepEqual(build(input, 10000, []).notes, ['N_NO_STRUCTURAL_SECTIONS']);
  assert.equal(build({ ...input, title: 'Metadata' }).state.title, 'Metadata');
});

test('policy acceptance and matching tokenizer are required; invalid codec cannot change text', () => {
  assert.throws(() => buildDigest(input, { budget: 10000, vocabulary: [], policy: { ...policy, acceptedBy: '' }, codec }), /accepted/);
  assert.throws(() => buildDigest(input, { budget: 10000, vocabulary: [], policy, codec: { ...codec, id: 'other' } }), /tokenizer/);
  const baseline = build({ ...input, blocks: [] });
  assert.throws(() => buildDigest(input, { budget: baseline.tokenCount + 60, vocabulary: [], policy,
    codec: { ...codec, prefixWithinBudget: () => 'invented' } }), /prefix/);
});

test('outline recovery accepts exact whole lines and preserves positions and whitespace', () => {
  const text = ' A\r\nB\n A\nC';
  const result = verifyRecoveredHeadings(text, [' A', 'A', 'B', ' B', 'B\n A', 'invented']);
  assert.deepEqual(result.verified, [{ text: ' A', positions: [0, 6] }, { text: 'B', positions: [4] }]);
  assert.equal(result.rejected.length, 4);
  assert.equal(result.verified[0].positions.length, 2);
});

test('outline recovery does not trim or repair model output', () => {
  const candidates = ['x', 'x', 'X'];
  assert.deepEqual(verifyRecoveredHeadings('x', candidates).verified, [{ text: 'x', positions: [0] }, { text: 'x', positions: [0] }]);
  assert.deepEqual(candidates, ['x', 'x', 'X']);
});

test('exact budget boundary succeeds and inputs are never mutated', () => {
  const before = structuredClone(input);
  const complete = build();
  const exact = build(input, complete.tokenCount);
  assert.equal(exact.serialized, complete.serialized);
  assert.deepEqual(input, before);
});

test('structural terms match whole Unicode word sequences, never substrings', () => {
  assert.deepEqual(build(input, 10000, ['meth']).notes, ['N_NO_STRUCTURAL_SECTIONS']);
  assert.deepEqual(build(input, 10000, ['METHOD']).notes, []);
});

test('unattached blocks come after heading sections and every block is accounted for', () => {
  const data = { ...input, blocks: [...input.blocks, { position: 1, text: 'c' }] };
  const result = build(data);
  assert.equal(result.state.sections.at(-1)?.headingId, null);
  assert.equal(result.selectionLog.filter(log => log.kind === 'block').length, 3);
});
