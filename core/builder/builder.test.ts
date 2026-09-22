import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, planTree, sha256, type BuilderManifest, type Destination, type SourceFile } from './builder.ts';

const bytes = new TextEncoder().encode('123');
async function fixture(folder = 'type_a') {
  const fingerprint = await sha256(bytes);
  const entry = { fingerprint, originalFilename: 'document.bin', tag: 'r1-0001', destinationFolder: folder,
    rule: folder === 'type_a' ? 'R1' : 'R5', reasoningNote: 'A decision is needed.',
    confidenceCheck: { choice: 'type_a', certainty: 0.8, noul: { type_a: 0.6 } },
    reader: [{ typeId: 'type_a', isType: true, rationale: 'Reason', evidence: ['123'], closestAlternative: null }] };
  const manifest: BuilderManifest = { runId: 'r1', entries: [entry] };
  const sources: SourceFile[] = [{ path: 'nested/document.bin', fingerprint, read: async () => bytes }];
  const files = new Map<string, Uint8Array>();
  const destination: Destination = { read: async (path) => files.get(path) ?? null,
    writeNew: async (path, data) => { if (files.has(path)) throw new Error('exists'); files.set(path, data); } };
  return { manifest, sources, files, destination };
}
const options = { naming: 'original' as const, destinationPrefix: 'C:/output', maxPathLength: 260, maxComponentLength: 255 };

test('builder copies by fingerprint and re-running skips identical originals and sidecars', async () => {
  const f = await fixture('human_review');
  const plan = planTree(f.manifest, options);
  const first = await buildTree(plan, f.sources, f.destination);
  assert.equal(first.entries[0].status, 'copied');
  const second = await buildTree(plan, f.sources, f.destination);
  assert.equal(second.entries[0].status, 'already_present');
  assert.equal(f.files.size, 4); // Two immutable summaries, original, sidecar.
  assert.deepEqual(f.files.get('human_review/r1-0001--document.bin'), bytes);
  assert.match(new TextDecoder().decode(f.files.get('human_review/r1-0001--document.bin.md')), /R5/);
});
test('missing source is listed in results and summary', async () => {
  const f = await fixture();
  const result = await buildTree(planTree(f.manifest, options), [], f.destination);
  assert.equal(result.entries[0].status, 'not_found');
  assert.match(new TextDecoder().decode(f.files.get(result.summaryPath)), /not found in source folder/i);
});
test('destination conflicts are retained byte for byte', async () => {
  const f = await fixture(); const path = 'type_a/r1-0001--document.bin';
  const previous = new Uint8Array([99]); f.files.set(path, previous);
  const result = await buildTree(planTree(f.manifest, options), f.sources, f.destination);
  assert.equal(result.entries[0].status, 'destination_conflict');
  assert.equal(f.files.get(path), previous);
});
test('source content is reverified immediately before copying', async () => {
  const f = await fixture(); f.sources[0].read = async () => new Uint8Array([9]);
  const result = await buildTree(planTree(f.manifest, options), f.sources, f.destination);
  assert.equal(result.entries[0].status, 'source_changed');
  assert.equal(f.files.size, 1);
});
test('path preflight blocks all writes and offers short naming without changing original name', async () => {
  const f = await fixture(); f.manifest.entries[0].originalFilename = 'x'.repeat(250) + '.bin';
  const plan = planTree(f.manifest, options);
  assert.equal(plan.warnings.length, 1);
  await assert.rejects(buildTree(plan, f.sources, f.destination), /shorter naming/i);
  assert.equal(f.files.size, 0);
  const short = planTree(f.manifest, { ...options, naming: 'short' });
  assert.equal(short.warnings.length, 0);
  assert.equal(short.entries[0].path, 'type_a/r1-0001.bin');
  assert.equal(short.entries[0].entry.originalFilename.length, 254);
});
test('unsafe paths and duplicate tags are rejected before writes', async () => {
  const f = await fixture('../outside');
  assert.throws(() => planTree(f.manifest, options), /name/i);
  f.manifest.entries[0].destinationFolder = 'type_a';
  f.manifest.entries.push({ ...f.manifest.entries[0] });
  assert.throws(() => planTree(f.manifest, options), /tag/i);
});
test('review sidecar preserves both vendor outputs and decision guidance', async () => {
  const f = await fixture('human_review');
  await buildTree(planTree(f.manifest, options), f.sources, f.destination);
  const sidecar = new TextDecoder().decode(f.files.get('human_review/r1-0001--document.bin.md'));
  for (const term of ['0.8', '0.6', 'Reason', '123', 'R5', 'Choose']) assert.ok(sidecar.includes(term));
});
test('a write failure remains explicit and a later invocation resumes', async () => {
  const f = await fixture(); let fail = true;
  const base = f.destination.writeNew;
  f.destination.writeNew = async (p, b) => { if (p.endsWith('.bin') && fail) { fail = false; throw new Error('permission'); } await base(p, b); };
  const first = await buildTree(planTree(f.manifest, options), f.sources, f.destination);
  assert.equal(first.entries[0].status, 'write_failed');
  assert.match(first.entries[0].details!, /permission/);
  const second = await buildTree(planTree(f.manifest, options), f.sources, f.destination);
  assert.equal(second.entries[0].status, 'copied');
});

test('conflicting sidecars are retained and make build incomplete', async () => {
  const f = await fixture('human_review');
  const path = 'human_review/r1-0001--document.bin.md';
  const original = new TextEncoder().encode('existing note');
  f.files.set(path, original);
  const result = await buildTree(planTree(f.manifest, options), f.sources, f.destination);
  assert.equal(result.entries[0].status, 'sidecar_conflict');
  assert.equal(result.complete, false);
  assert.equal(f.files.get(path), original);
});
test('cancellation lists every unattempted document and preserves an incomplete summary', async () => {
  const f = await fixture();
  const controller = new AbortController(); controller.abort();
  const result = await buildTree(planTree(f.manifest, options), f.sources, f.destination, { signal: controller.signal });
  assert.equal(result.entries[0].status, 'cancelled'); assert.equal(result.complete, false);
  assert.equal(f.files.size, 1);
});


test('failure sidecars retain manifest failure details without changing source decisions',async()=>{
 const f=await fixture('could_not_process');
 const failure={code:'E_READER_SCHEMA',message:'Exact evidence validation failed.'};
 const manifest={...f.manifest,notes:[{fingerprint:f.manifest.entries[0].fingerprint,notes:[],failure}]};
 const before=JSON.stringify(manifest);const plan=planTree(manifest,options);
 await buildTree(plan,f.sources,f.destination);
 const note=new TextDecoder().decode(f.files.get('could_not_process/r1-0001--document.bin.md'));
 assert.ok(note.includes(failure.code));assert.ok(note.includes(failure.message));assert.equal(JSON.stringify(manifest),before);
});
