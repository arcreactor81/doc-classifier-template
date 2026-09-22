import test from 'node:test';
import assert from 'node:assert/strict';
import { batchResultStager } from './batch-runner.ts';
import type { Runner } from './execution.ts';
import type { ProjectPack } from '../config/project.ts';
import type { BatchDependencies } from '../vendors/batch.ts';
const rates = { inputNanodollarsPerMillion: '1000000000', outputNanodollarsPerMillion: '1000000000' };
const pack = { pins: { reader: { id: 'gpt-5.6-terra' } }, prices: { verifiedAt: '2026-09-22', source: 'verified', batch: { reader: rates } } } as unknown as ProjectPack;
function harness() {
  const events: string[] = [], calls = new Map<string, unknown[]>(); let artifacts = 0;
  const runner = { run: { id: 'run1' }, env: { DB: { prepare: () => ({ bind: (...values: unknown[]) => ({ run: async () => {
    events.push('call'); const key = String(values[0]); if (calls.has(key)) return { meta: { changes: 0 } }; calls.set(key, values); return { meta: { changes: 1 } };
  } }) }) } }, store: {
    put: async () => { events.push('raw'); return `artifact${++artifacts}`; }, event: async () => { events.push('event'); },
  } } as unknown as Runner;
  return { events, calls, stage: batchResultStager(runner, pack, 'batch1') };
}
const value = (valid = true): Parameters<BatchDependencies['stageResult']>[0] => ({ customId: 'doc1', source: { retrievalId: 'retrieval1', fileId: 'file1', lineNumber: 1 }, result: {
  customId: 'doc1', error: null, response: { status_code: 200, request_id: 'request1', body: { model: 'gpt-5.6-terra', usage: valid ? { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } : null } },
} });

test('Batch raw and usage row persist before an accounting blocker propagates', async () => {
  const h = harness();
  await assert.rejects(h.stage(value(false)), (error: unknown) => (error as { code: string }).code === 'E_VENDOR_USAGE');
  assert.deepEqual(h.events, ['raw', 'call', 'event']);
  assert.equal(h.calls.get('batch1-doc1')?.[10], null);
});

test('duplicate Batch lines retain separate raw audit records but charge the request only once', async () => {
  const h = harness();
  assert.equal(await h.stage(value()), 'artifact1');
  assert.equal(await h.stage(value()), 'artifact2');
  assert.equal(h.calls.size, 1);
  assert.equal(h.calls.get('batch1-doc1')?.[10], '15000');
  assert.equal(h.events.filter(event => event === 'raw').length, 2);
});

test('unsuccessful Batch requests without usage preserve unknown cost and allow per-document failure ingestion', async () => {
  for (const result of [
    { customId: 'doc1', response: null, error: { code: 'batch_expired' } },
    { customId: 'doc1', response: { status_code: 400, request_id: 'request1', body: { error: { code: 'invalid_request' } } }, error: null },
  ]) {
    const h = harness();
    assert.equal(await h.stage({ ...value(), result }), 'artifact1');
    assert.equal(h.calls.get('batch1-doc1')?.[10], null);
    assert.deepEqual(h.events, ['raw', 'call', 'event']);
  }
});
