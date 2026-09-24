import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type LocalDirectoryHandle, type LocalFileHandle } from '../builder/browser.ts';
import { discoverGeneratedTrees, scanExtractionSource } from './source-scan.ts';
const uuid = '12345678-1234-4234-8234-123456789abc';
function directory(name: string, children: (LocalDirectoryHandle | LocalFileHandle)[]): LocalDirectoryHandle {
  return { kind: 'directory', name, async *values() { yield* children; },
    async getDirectoryHandle() { throw Error('Unexpected lookup'); }, async getFileHandle() { throw Error('Unexpected lookup'); } };
}
function file(name: string, text: string): LocalFileHandle {
  return { kind: 'file', name, getFile: async () => new Blob([text]), createWritable: async () => { throw Error('Read only'); } };
}
function fixture() {
  const summary = file(`build-summary-${uuid}.md`, `# Local build summary\n\nRun: ${uuid}\n\nComplete`);
  return directory('source', [file('original.pdf', 'original'), directory('output', [summary, directory('category', [file('tag--original.pdf', 'original')])]), directory('ordinary', [file('another.pdf', 'another')])]);
}
test('source discovery recognizes builder marker and never drops output copies by default', async () => {
  const root = fixture();
  assert.deepEqual(await discoverGeneratedTrees(root), [{path:'output',runId:uuid,summaryPath:`output/build-summary-${uuid}.md`}]);
  assert.equal((await scanExtractionSource(root)).length, 4);
});
test('explicit generated-tree exclusion keeps original and ordinary directories', async () => {
  const rows = await scanExtractionSource(fixture(), {excludedGeneratedTrees:['output']});
  assert.deepEqual(rows.map(row=>row.path), ['original.pdf','ordinary/another.pdf']);
  assert.equal(new TextDecoder().decode(await rows[0].read()), 'original');
});
test('name alone, malformed marker and unrelated markdown never identify output', async () => {
  const root=directory('source',[directory('output',[file('original.pdf','keep')]),directory('other',[file(`build-summary-${uuid}.md`,'# Some other summary')])]);
  assert.deepEqual(await discoverGeneratedTrees(root),[]);
  await assert.rejects(scanExtractionSource(root,{excludedGeneratedTrees:['output']}));
  assert.equal((await scanExtractionSource(root)).length,2);
});
test('selected generated root is detected but cannot be excluded into an empty successful scan', async()=>{
  const root=directory('output',[file(`build-summary-${uuid}.md`,`# Local build summary\n\nRun: ${uuid}\n`)]);
  assert.equal((await discoverGeneratedTrees(root))[0].path,'');
  await assert.rejects(scanExtractionSource(root,{excludedGeneratedTrees:['']}));
});
test('cancelled and unreadable scans fail loudly',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(discoverGeneratedTrees(fixture(),{signal:controller.signal}),{name:'AbortError'});
  const bad=file(`build-summary-${uuid}.md`,'');bad.getFile=async()=>{throw new DOMException('Denied','NotAllowedError');};
  await assert.rejects(discoverGeneratedTrees(directory('root',[bad])),{name:'NotAllowedError'});
});
