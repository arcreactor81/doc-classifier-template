import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBatchArtifacts, GROUP_BYTES, SINGLE_BYTES } from './batch-groups.ts';
const row = (n: number, bytes: number) => ({ fingerprint: String(n), request_key: `request-${n}`, bytes });

test('groups immutable request references by at most8MiB aggregate without loading bodies', () => {
  const rows = [row(1, GROUP_BYTES / 2), row(2, GROUP_BYTES / 2), row(3, 1)];
  const before = structuredClone(rows);
  assert.deepEqual(groupBatchArtifacts(rows).map(group => group.map(item => item.fingerprint)), [['1', '2'], ['3']]);
  assert.deepEqual(rows, before);
});

test('single larger artifacts up to32MiB form isolated groups and larger ones fail loudly', () => {
  assert.deepEqual(groupBatchArtifacts([row(1, 1), row(2, SINGLE_BYTES), row(3, 1)]).map(group => group.length), [1, 1, 1]);
  assert.throws(() => groupBatchArtifacts([row(1, SINGLE_BYTES + 1)]), /memory/i);
});

test('group plan is deterministic and rejects missing, duplicate or invalid metadata', () => {
  const rows = [row(1, 1), row(2, GROUP_BYTES), row(3, 1)];
  assert.deepEqual(groupBatchArtifacts(rows), groupBatchArtifacts(rows));
  assert.throws(() => groupBatchArtifacts([row(1, 1), row(1, 1)]), /duplicate/i);
  assert.throws(() => groupBatchArtifacts([row(1, 0)]), /size/i);
});
