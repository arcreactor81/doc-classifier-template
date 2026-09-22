import test from 'node:test';
import assert from 'node:assert/strict';
import { diffCorrection } from './diff.ts';
import { proposeCorrections, type ProposalInput } from './proposals.ts';
function fixture(count = 50): ProposalInput {
  const manifest = Array.from({ length: count }, (_, n) => ({ fingerprint: String(n).padStart(64, '0'), tag: `r-${n}`, originalFilename: `${n}.pdf`, destinationFolder: 'type_a', rule: 'R1' }));
  return { correctionId: 'c-1', currentThreshold: 0.9, minimumFiledCount: 50,
    diff: diffCorrection({ manifest, files: manifest.map(entry => ({ folder: 'type_a', filename: `${entry.tag} ${entry.originalFilename}`, tag: entry.tag })), checkedFolders: ['type_a'], typeFolders: ['type_a', 'type_b'], sidecarPaths: [] }),
    evidence: Object.fromEntries(manifest.map(entry => [entry.tag, { certainty: 0.98, agreedType: 'type_a', title: entry.originalFilename, digestLines: ['1'] }])),
    types: [{ id: 'type_a', name: 'Type A' }, { id: 'type_b', name: 'Type B' }], folderDecisions: [],
    renderNotFor: (from, to) => `${from.name}: ${to.name}`,
  };
}
function move(input: ProposalInput, index: number, to: string, certainty: number) {
  const match = input.diff.confirmations.splice(index, 1)[0];
  input.evidence[match.entry.tag].certainty = certainty;
  input.diff.moves.push({ ...match, file: { ...match.file, folder: to }, from: match.entry.destinationFolder, to, kind: 'misfile' });
}

test('raise proposal uses lowest correct certainty above all wrong, never mutates evidence', () => {
  const input = fixture(); move(input, 0, 'type_b', 0.91);
  const before = JSON.stringify(input);
  const result = proposeCorrections(input);
  assert.deepEqual(result.filedCheck, { checked: 50, wrong: 1, correct: 49, status: 'raise_proposed' });
  assert.equal(result.raise?.threshold, 0.98);
  assert.equal(result.raise?.correctSentToReview, 0);
  assert.equal(result.raise?.wrongSentToReview, 1);
  assert.equal(result.raise?.correctionId, 'c-1');
  assert.equal(JSON.stringify(input), before);
});

test('below minimum preserves counts without recommending either threshold direction', () => {
  const input = fixture(49); move(input, 0, 'type_b', 0.91);
  const result = proposeCorrections(input);
  assert.equal(result.filedCheck.checked, 49);
  assert.equal(result.filedCheck.status, 'insufficient_sample');
  assert.equal(result.raise, null); assert.equal(result.lower, null);
});

test('overlapping and equal certainties cannot separate; unchecked and deleted excluded', () => {
  const input = fixture(); move(input, 0, 'type_b', 0.98);
  let result = proposeCorrections(input);
  assert.equal(result.filedCheck.status, 'cannot_separate');
  const unchecked = input.diff.confirmations.pop()!;
  input.diff.unchecked.push(unchecked);
  result = proposeCorrections(input);
  assert.equal(result.filedCheck.checked, 49);
});

test('lowering uses human R2 labels, zero observed errors at or above candidate', () => {
  const input = fixture();
  for (const [n, certainty, to] of [[100, 0.7, 'type_a'], [101, 0.6, 'type_b']] as const) {
    const entry = { fingerprint: String(n).padStart(64, '0'), tag: `r-${n}`, originalFilename: `${n}.pdf`, destinationFolder: 'human_review', rule: 'R2' };
    input.diff.moves.push({ entry, file: { folder: to, filename: entry.originalFilename, tag: entry.tag }, matchedBy: 'tag', from: 'human_review', to, kind: 'human_label' });
    input.evidence[entry.tag] = { certainty, agreedType: 'type_a', title: entry.originalFilename, digestLines: [] };
  }
  const result = proposeCorrections(input);
  assert.equal(result.lower?.threshold, 0.7);
  assert.equal(result.lower?.additionalAutomaticLabels, 1);
  assert.equal(result.lower?.observedErrors, 0);
  input.evidence['r-101'].certainty = 0.8;
  assert.equal(proposeCorrections(input).lower, null);
});

test('unknown folders need explicit decisions; ignored entries excluded and new types are incomplete stubs', () => {
  const input = fixture(); move(input, 0, 'Proposed Type', 0.91);
  const moved = input.diff.moves[0]; moved.kind = 'unresolved_folder';
  input.diff.unknownFolders = [{ folder: moved.to, files: [moved.file] }];
  let result = proposeCorrections(input);
  assert.deepEqual(result.unresolvedFolders, ['Proposed Type']);
  assert.equal(result.filedCheck.checked, 49);
  input.folderDecisions = [{ folder: moved.to, action: 'new_type' }];
  result = proposeCorrections(input);
  assert.equal(result.newTypes[0].id, 'proposed_type');
  assert.equal(result.newTypes[0].what, ''); assert.equal(result.newTypes[0].not_for, '');
  assert.equal(result.newTypes[0].examples.length, 1);
  assert.equal(result.filedCheck.checked, 50);
  input.folderDecisions = [{ folder: moved.to, action: 'ignore' }];
  assert.equal(proposeCorrections(input).filedCheck.checked, 49);
});

test('examples use confirmed and human-labelled records, not unchecked guesses; not_for is only a candidate', () => {
  const input = fixture(3); move(input, 0, 'type_b', 0.91);
  input.diff.unchecked.push(input.diff.confirmations.pop()!);
  const result = proposeCorrections(input);
  assert.equal(result.examples.length, 2);
  assert.deepEqual(result.examples.map(item => item.typeId).sort(), ['type_a', 'type_b']);
  assert.equal(result.notFor.length, 1);
  assert.equal(result.notFor[0].candidate, 'Type A: Type B');
});

test('human labels after processing failures accept metadata-only evidence without invented certainty', () => {
  const input = fixture(1);
  const match = input.diff.confirmations.pop()!;
  match.entry.rule = 'R0'; match.entry.destinationFolder = 'could_not_process';
  input.diff.moves.push({ ...match, file: { ...match.file, folder: 'type_b' }, from: 'could_not_process', to: 'type_b', kind: 'human_label' });
  input.evidence[match.entry.tag] = { certainty: null, agreedType: null, title: match.entry.originalFilename, digestLines: [] };
  const result = proposeCorrections(input);
  assert.equal(result.filedCheck.checked, 0);
  assert.equal(result.examples.length, 1);
  assert.equal(result.examples[0].typeId, 'type_b');
  assert.equal(result.raise, null); assert.equal(result.lower, null);
});

test('missing recorded certainty remains invalid for automatic-label threshold evidence', () => {
  const input = fixture(1); input.evidence['r-0'].certainty = null;
  assert.throws(() => proposeCorrections(input), /certainty/i);
});
