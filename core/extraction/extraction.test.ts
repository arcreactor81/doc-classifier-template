import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserSupported, inferPdfHeadings, type PdfLine } from './policy.ts';
import { parseDocxParts, parsePptxParts } from './office.ts';

const word = (offset: number) => Array.from({ length: 8 }, (_, i) => String.fromCharCode(65 + (i + offset) % 26)).join('');
const policy = { largeFontRatio: 1.2, maximumHeadingCharacters: 120, topPageFraction: 0.2, gapRatio: 1.5, minimumHeadings: 2 };
test('browser gate allows only desktop Chrome and Edge with folder picker support', () => {
  assert.equal(browserSupported('Mozilla/5.0 Windows Chrome/130.0 Safari/537.36', true), true);
  assert.equal(browserSupported('Mozilla/5.0 Windows Chrome/130.0 Safari/537.36 Edg/130.0', true), true);
  for (const ua of ['Firefox/130.0', 'Version/18 Safari/605', 'Chrome/130 Android', 'CriOS/130 iPhone', 'Chrome/130 OPR/80']) assert.equal(browserSupported(ua, true), false);
  assert.equal(browserSupported('Chrome/130.0', false), false);
});
test('PDF headings require font emphasis, brevity, and structural position', () => {
  const lines: PdfLine[] = [
    { text: word(0), page: 1, x: 30, y: 30, fontSize: 15, bold: false, position: 0, pageHeight: 800 },
    ...Array.from({ length: 4 }, (_, n) => ({ text: word(n + 1), page: 1, x: 30, y: 70 + n * 12, fontSize: 10, bold: false, position: n + 1, pageHeight: 800 })),
    { text: word(5), page: 1, x: 30, y: 300, fontSize: 10, bold: true, position: 5, pageHeight: 800 },
    { text: word(6), page: 1, x: 30, y: 312, fontSize: 10, bold: true, position: 6, pageHeight: 800 },
  ];
  const headings = inferPdfHeadings(lines, policy);
  assert.deepEqual(headings.map(item => item.position), [0, 5]);
  assert.deepEqual(inferPdfHeadings(lines, policy), headings);
  assert.throws(() => inferPdfHeadings(lines, { ...policy, gapRatio: 0 }));
});
test('DOCX preserves heading styles, ordered paragraphs, table headers and page breaks', () => {
  const parts = new Map([
    ['word/document.xml', `<w:document xmlns:w="urn:w"><w:body><w:p><w:pPr><w:pStyle w:val="H1"/></w:pPr><w:r><w:t>${word(0)}</w:t></w:r></w:p><w:p><w:r><w:t>${word(1)}</w:t><w:br w:type="page"/><w:t>${word(2)}</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>${word(3)}</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>${word(4)}</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`],
    ['word/styles.xml', '<w:styles xmlns:w="urn:w"><w:style w:styleId="H1"><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>'],
  ]);
  const result = parseDocxParts(parts);
  assert.equal(result.outline.headings[0].text, word(0));
  assert.equal(result.outline.headings[0].level, 1);
  assert.deepEqual(result.outline.tables[0].headers, [word(3)]);
  for (let i = 0; i < 5; i++) assert.ok(result.fullText.includes(word(i)));
  assert.ok(result.fullText.includes('[Page 2]'));
  assert.ok(result.fullText.indexOf(word(1)) < result.fullText.indexOf(word(2)));
});
test('PPTX uses presentation relationship order and title placeholders', () => {
  const parts = new Map([
    ['ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="urn:r"><p:sldIdLst><p:sldId r:id="rId2"/><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>'],
    ['ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>'],
    ...[1, 2].map(n => [`ppt/slides/slide${n}.xml`, `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="urn:a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${word(n)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`] as [string, string]),
  ]);
  const result = parsePptxParts(parts);
  assert.deepEqual(result.outline.headings.map(item => item.text), [word(2), word(1)]);
  assert.ok(result.fullText.includes('[Slide 1]'));
});
test('missing required XML and invalid XML fail explicitly', () => {
  assert.throws(() => parseDocxParts(new Map()));
  assert.throws(() => parseDocxParts(new Map([['word/document.xml', '<invalid>']])));
  assert.throws(() => parsePptxParts(new Map()));
});

test('PPTX relationship IDs remain distinct from numeric slide IDs regardless of attribute order', () => {
  for (const attributes of ['id="256" r:id="rId1"', 'r:id="rId1" id="256"']) {
    const parts = new Map([
      ['ppt/presentation.xml', `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="urn:r"><p:sldIdLst><p:sldId ${attributes}/></p:sldIdLst></p:presentation>`],
      ['ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>'],
      ['ppt/slides/slide1.xml', `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="urn:a"><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${word(0)}</a:t></a:r></a:p></p:txBody></p:sp></p:sld>`],
    ]);
    assert.equal(parsePptxParts(parts).outline.headings[0].text, word(0));
  }
});

test('PPTX title associations stop at slide boundaries while tables and notes retain order',()=>{
 const paragraph=(text:string)=>'<a:p><a:r><a:t>'+text+'</a:t></a:r></a:p>';
 const shape=(text:string,title=false)=>'<p:sp>'+(title?'<p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>':'')+'<p:txBody>'+paragraph(text)+'</p:txBody></p:sp>';
 const slide=(body:string)=>'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="urn:a">'+body+'</p:sld>';
 const parts=new Map([
 ['ppt/presentation.xml','<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="urn:r"><p:sldIdLst><p:sldId r:id="a"/><p:sldId r:id="b"/></p:sldIdLst></p:presentation>'],
 ['ppt/_rels/presentation.xml.rels','<Relationships><Relationship Id="a" Target="slides/one.xml"/><Relationship Id="b" Target="slides/two.xml"/></Relationships>'],
 ['ppt/slides/one.xml',slide(shape(word(0),true)+shape(word(1)))],
 ['ppt/slides/two.xml',slide(shape(word(2))+'<a:tbl><a:tr><a:tc><a:txBody>'+paragraph(word(3))+'</a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody>'+paragraph(word(4))+'</a:txBody></a:tc></a:tr></a:tbl>')],
 ['ppt/slides/_rels/two.xml.rels','<Relationships><Relationship Id="notes" Type="urn:/notesSlide" Target="../notesSlides/notes.xml"/></Relationships>'],
 ['ppt/notesSlides/notes.xml',slide(shape(word(5)))],
 ]);
 const result=parsePptxParts(parts);
 assert.equal(result.fullText,['[Slide 1]',word(0),word(1),'[Slide 2]',word(2),word(3),word(4),word(5)].join('\n'));
 assert.equal(result.outline.blocks[0].headingId,result.outline.headings[0].id);
 for(const block of result.outline.blocks.slice(1))assert.equal(block.headingId,undefined);
 assert.deepEqual(result.outline.tables[0].headers,[word(3)]);
 for(const item of [...result.outline.headings,...result.outline.blocks])assert.equal(result.fullText.slice(item.position,item.position+item.text.length),item.text);
});

test('DOCX extracts displayed carriers not drawing geometry or field instructions, retaining textbox text and whitespace',()=>{
 const xml='<w:document xmlns:w="urn:w" xmlns:wp="urn:wp" xmlns:a="urn:a"><w:body><w:p><w:r><w:t>Visible</w:t><w:tab/><w:t>body</w:t><w:br/><w:instrText>INSTRUCTION_ONLY</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>Displayed field</w:t><w:drawing><wp:anchor><wp:positionH><wp:posOffset>731942</wp:posOffset></wp:positionH><wp:extent cx="999" cy="888"/><a:graphic><a:t>Drawing text</a:t></a:graphic></wp:anchor></w:drawing><w:txbxContent><w:p><w:r><w:t>Textbox text</w:t></w:r></w:p></w:txbxContent></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Header</w:t><w:drawing><wp:posOffset>829413</wp:posOffset></w:drawing></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
 const parts=new Map([['word/document.xml',xml],['docProps/core.xml','<cp:coreProperties xmlns:cp="urn:cp" xmlns:dc="urn:dc"><dc:title>Metadata title</dc:title></cp:coreProperties>']]);
 const result=parseDocxParts(parts);assert.equal(result.fullText,'[Page 1]\nVisible\tbody\nDisplayed fieldDrawing textTextbox text\nHeader');assert.equal(result.outline.title,'Metadata title');assert.deepEqual(result.outline.tables[0].headers,['Header']);
});
test('Office visible text carriers support namespace aliases without admitting unrelated text nodes',()=>{
 const xml='<w:document xmlns:w="urn:w" xmlns:alias="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="urn:metadata"><w:body><w:p><w:r><alias:t>Visible alias</alias:t><m:t>Not a text carrier</m:t><m:value>Metadata only</m:value></w:r></w:p></w:body></w:document>';
 assert.equal(parseDocxParts(new Map([['word/document.xml',xml]])).fullText,'[Page 1]\nVisible alias');
});


test('AlternateContent selects the first supported Choice and preserves namespace-alias text once',()=>{
 const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><w:body><w:p><w:r><mc:AlternateContent><mc:Choice Requires="wpg"><x:t>unsupported choice</x:t></mc:Choice><mc:Choice Requires="wps"><x:t>selected choice</x:t></mc:Choice><mc:Fallback><x:t>fallback copy</x:t></mc:Fallback></mc:AlternateContent></w:r></w:p></w:body></w:document>';
 assert.equal(parseDocxParts(new Map([['word/document.xml',xml]])).fullText,'[Page 1]\nselected choice');
});
test('AlternateContent uses declared Fallback for unknown Requires and never merges branches',()=>{
 const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:future="urn:future"><w:body><w:p><w:r><mc:AlternateContent><mc:Choice Requires="future"><w:t>future copy</w:t></mc:Choice><mc:Fallback><w:t>fallback copy</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p></w:body></w:document>';
 assert.equal(parseDocxParts(new Map([['word/document.xml',xml]])).fullText,'[Page 1]\nfallback copy');
});
test('AlternateContent without a supported Choice or Fallback fails explicitly',()=>{
 const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:future="urn:future"><w:body><w:p><w:r><mc:AlternateContent><mc:Choice Requires="future"><w:t>invisible</w:t></mc:Choice></mc:AlternateContent></w:r></w:p></w:body></w:document>';
 assert.throws(()=>parseDocxParts(new Map([['word/document.xml',xml]])),/AlternateContent/i);
});
test('AlternateContent branch selection controls nested table text and headers',()=>{
 const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><w:body><mc:AlternateContent><mc:Choice Requires="wps"><w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Selected header</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Selected body</w:t></w:r></w:p></w:tc></w:tr></w:tbl></mc:Choice><mc:Fallback><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Fallback header</w:t></w:r></w:p></w:tc></w:tr></w:tbl></mc:Fallback></mc:AlternateContent></w:body></w:document>';
 const result=parseDocxParts(new Map([['word/document.xml',xml]]));assert.equal(result.fullText,'[Page 1]\nSelected header\nSelected body');assert.deepEqual(result.outline.tables[0].headers,['Selected header']);
});


test('AlternateContent resolves Choice-local namespace bindings for Requires',()=>{
 const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:feature="urn:unsupported"><w:body><w:p><w:r><mc:AlternateContent><mc:Choice xmlns:feature="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" Requires="feature"><w:t>choice local binding</w:t></mc:Choice><mc:Fallback><w:t>fallback copy</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p></w:body></w:document>';
 assert.equal(parseDocxParts(new Map([['word/document.xml',xml]])).fullText,'[Page 1]\nchoice local binding');
});
test('AlternateContent rejects missing or empty mandatory Choice Requires',()=>{
 for(const requires of ['', undefined]){
  const attribute=requires===undefined?'':' Requires=""';
  const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body><w:p><w:r><mc:AlternateContent><mc:Choice'+attribute+'><w:t>ambiguous choice</w:t></mc:Choice><mc:Fallback><w:t>fallback copy</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p></w:body></w:document>';
  assert.throws(()=>parseDocxParts(new Map([['word/document.xml',xml]])),/Requires/i);
 }
});


for (const presentationNamespace of [
  'http://schemas.openxmlformats.org/presentationml/2006/main',
  'http://purl.oclc.org/ooxml/presentationml/main',
]) {
  test(`PPTX reads only the direct slide list, excluding section references (${presentationNamespace})`, () => {
    const relationshipNamespace = presentationNamespace.includes('purl.oclc.org')
      ? 'http://purl.oclc.org/ooxml/officeDocument/relationships'
      : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const parts = new Map([
      ['ppt/presentation.xml', `<deck:presentation xmlns:deck="${presentationNamespace}" xmlns:rel="${relationshipNamespace}" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><deck:sldIdLst><deck:sldId id="258" rel:id="second"/><deck:sldId id="257" rel:id="first"/></deck:sldIdLst><deck:extLst><deck:ext uri="urn:section-test"><p14:sectionLst><p14:section name="${word(7)}"><p14:sldIdLst><p14:sldId id="257"/><p14:sldId id="258"/></p14:sldIdLst></p14:section></p14:sectionLst><deck:sldIdLst><deck:sldId rel:id="nested"/></deck:sldIdLst></deck:ext></deck:extLst></deck:presentation>`],
      ['ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="first" Target="slides/first.xml"/><Relationship Id="second" Target="/ppt/slides/second.xml"/></Relationships>'],
      ...['first', 'second'].map((name, index) => [`ppt/slides/${name}.xml`, `<p:sld xmlns:p="${presentationNamespace}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:sp><p:txBody><a:p><a:r><a:t>${word(index)}</a:t></a:r></a:p></p:txBody></p:sp></p:sld>`] as [string, string]),
    ]);
    assert.equal(parsePptxParts(parts).fullText, `[Slide 1]\n${word(1)}\n[Slide 2]\n${word(0)}`);
  });
}

test('PPTX direct slide references still reject missing and external relationships', () => {
  for (const relationship of ['', '<Relationship Id="slide" Target="https://example.invalid/slide.xml" TargetMode="External"/>']) {
    const parts = new Map([
      ['ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="slide"/></p:sldIdLst></p:presentation>'],
      ['ppt/_rels/presentation.xml.rels', `<Relationships>${relationship}</Relationships>`],
    ]);
    assert.throws(() => parsePptxParts(parts), /A slide relationship is missing or external/);
  }
});
