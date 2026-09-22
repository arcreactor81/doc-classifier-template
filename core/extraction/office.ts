import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { DigestInput, DigestHeading, DigestTable, DigestBlock } from '../digest/digest.ts';

type XmlNode = Record<string, unknown>;
const namespaces=new WeakMap<XmlNode,string>();
export interface ParsedDocument { fullText: string; outline: DigestInput }
function parse(xml: string): XmlNode[] {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error(`Invalid document XML: ${valid.err.code}`);
  const nodes=new XMLParser({ preserveOrder: true, ignoreAttributes: false, removeNSPrefix: false, trimValues: false, parseTagValue: false, processEntities: true }).parse(xml) as XmlNode[];
  function visit(items:XmlNode[],inherited:Record<string,string>):void{for(const node of items){const scope={...inherited};for(const [key,value]of Object.entries((node[':@']??{}) as Record<string,string>)){if(key==='@_xmlns')scope['']=value;else if(key.startsWith('@_xmlns:'))scope[key.slice(8)]=value;}const qualified=rawTag(node),prefix=qualified.includes(':')?qualified.split(':')[0]:'';namespaces.set(node,scope[prefix]??'');visit(children(node),scope);}}
  visit(nodes,{});return nodes;
}
const rawTag = (node: XmlNode) => Object.keys(node).find(key => key !== ':@') ?? '';
const tag = (node: XmlNode) => rawTag(node).split(':').at(-1)!;
const children = (node: XmlNode): XmlNode[] => Array.isArray(node[rawTag(node)]) ? node[rawTag(node)] as XmlNode[] : [];
function attr(node: XmlNode, key: string, namespacedOnly = false): string | undefined {
  const attributes = node[':@'] as Record<string, string> | undefined;
  if (!attributes) return undefined;
  if (!namespacedOnly && attributes['@_' + key] !== undefined) return attributes['@_' + key];
  const matching = Object.entries(attributes).filter(([name]) => name.startsWith('@_') && name.includes(':') && name.split(':').at(-1) === key);
  if (matching.length > 1) throw new Error('Ambiguous XML attribute namespace.');
  return matching[0]?.[1];
}
function all(nodes: readonly XmlNode[], name: string): XmlNode[] {
  return nodes.flatMap(node => [...(tag(node) === name ? [node] : []), ...all(children(node), name)]);
}
function child(node: XmlNode, name: string): XmlNode | undefined { return children(node).find(item => tag(item) === name); }
function required(parts: ReadonlyMap<string, string>, path: string): XmlNode[] {
  const xml = parts.get(path);
  if (xml === undefined) throw new Error(`Required document part is missing: ${path}`);
  return parse(xml);
}
const textNamespaces=new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://schemas.openxmlformats.org/drawingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main','http://purl.oclc.org/ooxml/drawingml/main']);
const textCarrier=(node:XmlNode)=>tag(node)==='t'&&(['w:t','a:t'].includes(rawTag(node))||textNamespaces.has(namespaces.get(node)??''));
const literal=(node:XmlNode)=>children(node).filter(child=>rawTag(child)==='#text').map(child=>String(child['#text'])).join('');
function plain(nodes: readonly XmlNode[]): string {
  return nodes.map(node => {
    if (textCarrier(node)) return literal(node);
    if (tag(node) === '#text') return '';
    if (tag(node) === 'tab') return '\t';
    if (tag(node) === 'br') return '\n';
    return plain(children(node));
  }).join('');
}
function paragraphText(node: XmlNode): string {
  return children(node).filter(item => !['pPr', 'rPr', 'endParaRPr'].includes(tag(item))).map(item => plain([item])).join('');
}
class Accumulator {
  chunks: string[] = [];
  headings: DigestHeading[] = [];
  tables: DigestTable[] = [];
  blocks: DigestBlock[] = [];
  position = 0;
  currentHeading: string | undefined;
  add(text: string, level?: number): void {
    if (!text.trim()) return;
    const position = this.position;
    this.position += text.length + 1;
    this.chunks.push(text);
    if (level !== undefined) {
      this.currentHeading = `heading_${position}`;
      this.headings.push({ id: this.currentHeading, text, level, position });
    } else this.blocks.push({ text, position, ...(this.currentHeading ? { headingId: this.currentHeading } : {}) });
  }
  marker(value: string): void { this.chunks.push(value); this.position += value.length + 1; }
  table(node: XmlNode): void {
    const rows = children(node).filter(item => tag(item) === 'tr');
    const selected = rows.find(row => all(children(row), 'tblHeader').length > 0) ?? rows[0];
    const cells = (row: XmlNode) => children(row).filter(item => tag(item) === 'tc').map(cell => all(children(cell), 'p').map(paragraphText).join('\n'));
    if (selected) this.tables.push({ position: this.position, headers: cells(selected) });
    for (const row of rows) this.add(cells(row).join('\t'));
  }
  finish(title?: string): ParsedDocument {
    return { fullText: this.chunks.join('\n'), outline: { ...(title ? { title } : {}), headings: this.headings, tables: this.tables, blocks: this.blocks } };
  }
}
function metadataTitle(parts: ReadonlyMap<string, string>): string | undefined {
  const core = parts.get('docProps/core.xml');
  return core === undefined ? undefined : all(parse(core), 'title').map(literal).find(value => value.trim());
}

export function parseDocxParts(parts: ReadonlyMap<string, string>): ParsedDocument {
  const root = required(parts, 'word/document.xml');
  const body = all(root, 'body')[0];
  if (!body) throw new Error('The document body is missing.');
  const styles = new Map<string, { level?: number; parent?: string }>();
  const styleXml = parts.get('word/styles.xml');
  for (const style of styleXml ? all(parse(styleXml), 'style') : []) {
    const id = attr(style, 'styleId');
    const outline = all(children(style), 'outlineLvl')[0];
    const level = outline ? Number(attr(outline, 'val')) : undefined;
    if (id) styles.set(id, { ...(level !== undefined && level >= 0 && level < 9 ? { level: level + 1 } : {}), parent: child(style, 'basedOn') ? attr(child(style, 'basedOn')!, 'val') : undefined });
  }
  function styleLevel(id: string | undefined, seen = new Set<string>()): number | undefined {
    if (!id) return undefined;
    if (seen.has(id)) throw new Error('Document heading styles contain a cycle.');
    seen.add(id);
    const style = styles.get(id);
    return style?.level ?? styleLevel(style?.parent, seen);
  }
  const acc = new Accumulator();
  let page = 1;
  acc.marker(`[Page ${page}]`);
  function walk(nodes: readonly XmlNode[]): void {
    for (const node of nodes) {
      if (tag(node) === 'tbl') { acc.table(node); continue; }
      if (tag(node) === 'p') {
        const properties = child(node, 'pPr');
        const outline = properties ? child(properties, 'outlineLvl') : undefined;
        const rawLevel = outline ? Number(attr(outline, 'val')) : undefined;
        const level = rawLevel !== undefined ? (rawLevel >= 0 && rawLevel < 9 ? rawLevel + 1 : undefined) : styleLevel(properties ? attr(child(properties, 'pStyle') ?? {}, 'val') : undefined);
        // Word stores explicit/rendered page breaks inside runs; preserve their location.
        let buffer = '';
        function run(items: readonly XmlNode[]): void {
          for (const item of items) {
            const name = tag(item);
            if (name === 'pPr' || name === 'rPr') continue;
            if (name === 'lastRenderedPageBreak' || (name === 'br' && attr(item, 'type') === 'page')) {
              acc.add(buffer, level); buffer = ''; acc.marker(`[Page ${++page}]`);
            } else if (textCarrier(item)) buffer += literal(item);
            else if (name === '#text') continue;
            else if (name === 'tab') buffer += '\t';
            else if (name === 'br') buffer += '\n';
            else run(children(item));
          }
        }
        run(children(node)); acc.add(buffer, level);
      } else walk(children(node));
    }
  }
  walk(children(body));
  for (const [path, xml] of parts) {
    if (/^word\/(?:header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(path)) walk(parse(xml));
  }
  return acc.finish(metadataTitle(parts));
}

function resolvePart(base: string, target: string): string {
  if (/^[a-z]+:/i.test(target)) throw new Error('External document relationships are not supported.');
  const segments = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (!segments.length) throw new Error('Invalid document relationship path.'); segments.pop(); }
    else segments.push(segment);
  }
  return segments.join('/');
}
function relations(parts: ReadonlyMap<string, string>, base: string): XmlNode[] {
  const bits = base.split('/'); const file = bits.pop()!;
  const rel = parts.get([...bits, '_rels', `${file}.rels`].join('/'));
  return rel ? all(parse(rel), 'Relationship') : [];
}
export function parsePptxParts(parts: ReadonlyMap<string, string>): ParsedDocument {
  const base = 'ppt/presentation.xml';
  const presentation = required(parts, base);
  const rels = relations(parts, base);
  const ids = all(presentation, 'sldId');
  if (!ids.length) throw new Error('The presentation contains no slides.');
  const acc = new Accumulator();
  for (const [index, id] of ids.entries()) {
    const relationship = rels.find(rel => attr(rel, 'Id') === attr(id, 'id', true));
    const target = relationship && attr(relationship, 'Target');
    if (!target || attr(relationship!, 'TargetMode') === 'External') throw new Error('A slide relationship is missing or external.');
    const path = resolvePart(base, target);
    const slide = required(parts, path);
    const slideRels = relations(parts, path);
    const layoutRel = slideRels.find(rel => attr(rel, 'Type')?.endsWith('/slideLayout'));
    const layoutTarget = layoutRel && attr(layoutRel, 'Target');
    const layout = layoutTarget ? required(parts, resolvePart(path, layoutTarget)) : [];
    acc.currentHeading = undefined;
    acc.marker(`[Slide ${index + 1}]`);
    function walk(nodes: readonly XmlNode[]): void {
      for (const node of nodes) {
        if (tag(node) === 'tbl') { acc.table(node); continue; }
        if (tag(node) === 'sp') {
          const placeholder = all(children(node), 'ph')[0];
          const inherited = placeholder && all(layout, 'ph').find(ph => (attr(ph, 'idx') ?? '0') === (attr(placeholder, 'idx') ?? '0'));
          const kind = placeholder ? attr(placeholder, 'type') ?? (inherited && attr(inherited, 'type')) : undefined;
          const title = kind === 'title' || kind === 'ctrTitle';
          const paragraphs = all(children(node), 'p');
          if (title) acc.add(paragraphs.map(paragraphText).join('\n'), 1);
          else for (const paragraph of paragraphs) acc.add(paragraphText(paragraph));
        } else walk(children(node));
      }
    }
    walk(slide);
    const notesRel = slideRels.find(rel => attr(rel, 'Type')?.endsWith('/notesSlide'));
    const notesTarget = notesRel && attr(notesRel, 'Target');
    if (notesTarget) walk(required(parts, resolvePart(path, notesTarget)));
  }
  return acc.finish(metadataTitle(parts));
}

/** XML text parts reachable through content relationships; images are never read. */
export function relatedTextParts(xml: string, sourcePart: string): string[] {
  return all(parse(xml), 'Relationship').flatMap(rel => {
    const type = attr(rel, 'Type');
    const target = attr(rel, 'Target');
    if (!target || attr(rel, 'TargetMode') === 'External' || !type || !/\/(?:slide|slideLayout|notesSlide|header|footer|footnotes|endnotes|styles)$/.test(type)) return [];
    return [resolvePart(sourcePart, target)];
  });
}