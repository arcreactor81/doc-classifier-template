import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { readOfficeParts, fingerprint, extractDocument } from './extract.ts';
const generated = Array.from({ length: 16 }, (_, i) => String.fromCharCode(65 + i)).join('');
test('ZIP extraction reads related text XML and skips all images and unrelated XML', async () => {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add('word/document.xml', new TextReader(`<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>${generated}</w:t></w:r></w:p></w:body></w:document>`));
  await writer.add('word/_rels/document.xml.rels', new TextReader('<Relationships><Relationship Id="r1" Type="urn:/header" Target="header1.xml"/><Relationship Id="r2" Type="urn:/image" Target="media/image1.png"/></Relationships>'));
  await writer.add('word/header1.xml', new TextReader('<w:hdr xmlns:w="urn:w"/>'));
  await writer.add('word/media/image1.png', new TextReader(generated));
  await writer.add('unused.xml', new TextReader(generated));
  const parts = await readOfficeParts(await writer.close(), 'docx');
  assert.deepEqual([...parts.keys()], ['word/document.xml', 'word/_rels/document.xml.rels', 'word/header1.xml']);
});
test('fingerprints use the complete local bytes deterministically', async () => {
  const one = await fingerprint(new Blob([generated]));
  const two = await fingerprint(new Blob([generated]));
  const changed = await fingerprint(new Blob([generated + generated]));
  assert.equal(one.length, 64);
  assert.equal(one, two);
  assert.notEqual(one, changed);
});
test('unsupported files fail explicitly before parser execution', async () => {
  for(const name of ['type_a.bin','type_a.ppt','type_a.PPT'])await assert.rejects(extractDocument(new File([generated], name), {
    pdfWorkerUrl: '/pdf.worker.mjs', parserVersions: { pdf: '1', zip: '1', xml: '1' },
    pdfPolicy: { largeFontRatio: 1.2, maximumHeadingCharacters: 120, topPageFraction: 0.2, gapRatio: 1.5, minimumHeadings: 2 },
  }), { code: 'E_UNSUPPORTED_FORMAT' });
});