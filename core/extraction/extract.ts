import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import { parseDocxParts, parsePptxParts, relatedTextParts, type ParsedDocument } from './office.ts';
import { inferPdfHeadings, validatePdfPolicy, type PdfHeadingPolicy, type PdfLine } from './policy.ts';
import { taggedTables, type MarkedText } from './pdf-structure.ts';
import type { DigestHeading, DigestTable } from '../digest/digest.ts';

export const EXTRACTOR_VERSION = 'local-extractor-1.0.2';
export interface ExtractOptions {
  pdfWorkerUrl: string;
  pdfPolicy: PdfHeadingPolicy;
  parserVersions: { zip: string; xml: string; pdf: string };
}
export interface ExtractedDocument extends ParsedDocument {
  fingerprint: string;
  originalFilename: string;
  extractorVersion: string;
  parserVersions: ExtractOptions['parserVersions'];
  needsOutlineRecovery: boolean;
}
export class ExtractionFailure extends Error {
  readonly code: string;
  constructor(code: string, detail: string) { super(detail); this.name = 'ExtractionFailure'; this.code = code; }
}
export async function fingerprint(file: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
function relationshipPath(path: string): string {
  const bits = path.split('/'); const name = bits.pop()!;
  return [...bits, '_rels', `${name}.rels`].join('/');
}
export async function readOfficeParts(file: Blob, format: 'docx' | 'pptx'): Promise<Map<string, string>> {
  const zip = new ZipReader(new BlobReader(file));
  try {
    const entries = await zip.getEntries();
    const byPath = new Map(entries.map(entry => [entry.filename, entry]));
    if (byPath.size !== entries.length) throw new ExtractionFailure('E_EXTRACTION_ARCHIVE', 'The archive contains duplicate paths.');
    const parts = new Map<string, string>();
    async function read(path: string, required: boolean): Promise<string | undefined> {
      if (parts.has(path)) return parts.get(path)!;
      const entry = byPath.get(path);
      if (!entry || entry.directory) {
        if (required) throw new ExtractionFailure('E_EXTRACTION_XML', `Required document part is missing: ${path}`);
        return undefined;
      }
      const xml = await entry.getData(new TextWriter(), { checkSignature: true });
      parts.set(path, xml);
      return xml;
    }
    const start = format === 'docx' ? 'word/document.xml' : 'ppt/presentation.xml';
    const visited = new Set<string>();
    async function visit(path: string): Promise<void> {
      if (visited.has(path)) return;
      visited.add(path);
      await read(path, true);
      const rels = await read(relationshipPath(path), false);
      if (rels) for (const target of relatedTextParts(rels, path)) await visit(target);
    }
    await visit(start);
    if (format === 'docx') await read('word/styles.xml', false);
    await read('docProps/core.xml', false);
    return parts;
  } finally { await zip.close(); }
}
async function extractPdf(file: File, options: ExtractOptions): Promise<ParsedDocument> {
  if (!options.pdfWorkerUrl) throw new ExtractionFailure('E_EXTRACTOR_CONFIGURATION', 'The local PDF worker URL is missing.');
  const pdfjs = await import('pdfjs-dist');
  if (pdfjs.version !== options.parserVersions.pdf) throw new ExtractionFailure('E_EXTRACTOR_VERSION', 'The loaded PDF parser differs from the recorded version.');
  pdfjs.GlobalWorkerOptions.workerSrc = options.pdfWorkerUrl;
  // PDF.js automatic worker startup references window, which is absent in extraction workers.
  // Supply a dedicated nested Worker port explicitly rather than accepting its fake-worker path.
  const workerPort = new Worker(options.pdfWorkerUrl, { type: 'module' });
  const pdfWorker = pdfjs.PDFWorker.create({ port: workerPort });
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), stopAtErrors: true, worker: pdfWorker });
  try {
    const pdf = await task.promise;
    const lines: PdfLine[] = [];
    const tables: DigestTable[] = [];
    const chunks: string[] = [];
    const pagePositions: number[] = [];
    let position = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const marker = `[Page ${number}]`;
      chunks.push(marker); position += marker.length + 1; pagePositions.push(position);
      const content = await page.getTextContent({ disableNormalization: true, includeMarkedContent: true });
      const marked = new Map<string, MarkedText>();
      const markedStack: (string | undefined)[] = [];
      let current: PdfLine | undefined;
      function flush(): void {
        if (!current) return;
        if (current.text.trim()) {
          current.position = position;
          lines.push(current); chunks.push(current.text); position += current.text.length + 1;
        }
        current = undefined;
      }
      for (const item of content.items) {
        if (!('str' in item)) {
          if (item.type === 'endMarkedContent') markedStack.pop();
          else markedStack.push(item.type === 'beginMarkedContentProps' ? item.id : undefined);
          continue;
        }
        for (const id of new Set(markedStack.filter((value): value is string => value !== undefined))) {
          const prior = marked.get(id);
          marked.set(id, { text: (prior?.text ?? '') + item.str + (item.hasEOL ? '\n' : ''), position: prior?.position ?? position + (current?.text.length ?? 0) });
        }
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const size = Math.round(Math.hypot(item.transform[2], item.transform[3]) * 100) / 100;
        const family = content.styles[item.fontName]?.fontFamily ?? item.fontName;
        const bold = /bold|black|demi/i.test(`${family} ${item.fontName}`);
        if (current && (Math.abs(current.y - y) > 0.1 || current.fontSize !== size)) flush();
        if (!current) current = { text: item.str, page: number, x, y, fontSize: size, bold, pageHeight: viewport.height, position, itemFontSizes: [size] };
        else { current.text += item.str; current.bold ||= bold; current.itemFontSizes!.push(size); }
        if (item.hasEOL) flush();
      }
      flush(); tables.push(...taggedTables(await page.getStructTree(), marked)); page.cleanup();
    }
    if (!lines.some(line => line.text.trim())) throw new ExtractionFailure('E_NO_TEXT_LAYER', 'Scanned document, no text layer.');
    let headings: DigestHeading[] = [];
    const outline = await pdf.getOutline();
    type Bookmark = NonNullable<typeof outline>[number];
    async function bookmarks(items: readonly Bookmark[], level: number): Promise<void> {
      for (const item of items) {
        const destination = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
        if (destination && item.title.trim()) {
          const ref = destination[0];
          const pageIndex = typeof ref === 'number' ? ref : await pdf.getPageIndex(ref);
          if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdf.numPages) throw new ExtractionFailure('E_PDF_OUTLINE', 'A PDF bookmark points outside the document.');
          const match = lines.find(line => line.page === pageIndex + 1 && line.text.includes(item.title));
          headings.push({ id: `bookmark_${headings.length}`, text: item.title, level, position: match?.position ?? pagePositions[pageIndex] });
        }
        await bookmarks(item.items, level + 1);
      }
    }
    if (outline?.length) await bookmarks(outline, 1);
    if (!headings.length) headings = inferPdfHeadings(lines, options.pdfPolicy);
    headings.sort((a, b) => a.position - b.position);
    const blocks = lines.map(line => {
      const heading = headings.findLast(candidate => candidate.position <= line.position);
      return { text: line.text, position: line.position, ...(heading ? { headingId: heading.id } : {}) };
    });
    const metadata = await pdf.getMetadata();
    const info = metadata.info as { Title?: unknown };
    const title = typeof info.Title === 'string' && info.Title.trim() ? info.Title : undefined;
    return { fullText: chunks.join('\n'), outline: { ...(title ? { title } : {}), headings, tables, blocks } };
  } finally {
    try { await task.destroy(); } finally { pdfWorker.destroy(); workerPort.terminate(); }
  }
}
/** Reads originals locally only. This module contains no network upload operation. */
export async function extractDocument(file: File, options: ExtractOptions): Promise<ExtractedDocument> {
  validatePdfPolicy(options.pdfPolicy);
  if (!options.parserVersions || Object.values(options.parserVersions).length !== 3 || Object.values(options.parserVersions).some(value => typeof value !== 'string' || !value)) throw new ExtractionFailure('E_EXTRACTOR_CONFIGURATION', 'Explicit parser versions are required.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'docx' && extension !== 'pptx' && extension !== 'pdf') throw new ExtractionFailure('E_UNSUPPORTED_FORMAT', 'Unsupported file type.');
  const digest = await fingerprint(file);
  try {
    const parsed = extension === 'pdf' ? await extractPdf(file, options) : extension === 'docx' ? parseDocxParts(await readOfficeParts(file, 'docx')) : parsePptxParts(await readOfficeParts(file, 'pptx'));
    if (!parsed.outline.blocks.length && !parsed.outline.headings.length) throw new ExtractionFailure('E_NO_TEXT', 'The document contains no extractable text.');
    return { ...parsed, fingerprint: digest, originalFilename: file.name, extractorVersion: EXTRACTOR_VERSION, parserVersions: { ...options.parserVersions }, needsOutlineRecovery: extension === 'pdf' && parsed.outline.headings.length < options.pdfPolicy.minimumHeadings };
  } catch (error) {
    if (error instanceof ExtractionFailure) throw error;
    throw new ExtractionFailure('E_EXTRACTION', error instanceof Error ? error.message : String(error));
  }
}
