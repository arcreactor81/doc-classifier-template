/** Explicit, versioned project policy: JSON state; audit log outside model input. */
export const DIGEST_POLICY_VERSION = 'named-fields-json-v1' as const;
export interface DigestPolicy {
  version: typeof DIGEST_POLICY_VERSION;
  acceptedBy: string;
  acceptedAt: string;
  tokenizerId: string;
}
export interface DigestHeading { id: string; text: string; level: number; position: number }
export interface DigestTable { position: number; headers: readonly string[] }
export interface DigestBlock { position: number; headingId?: string; text: string }
export interface DigestInput {
  title?: string;
  headings: readonly DigestHeading[];
  tables: readonly DigestTable[];
  blocks: readonly DigestBlock[];
}
export interface DigestTokenCodec {
  id: string;
  countTokens(text: string): number;
  /** Return the longest literal prefix satisfying fits; never decode partial characters. */
  prefixWithinBudget(text: string, fits: (prefix: string) => boolean): string;
}
export interface DigestOptions {
  budget: number;
  vocabulary: readonly string[];
  policy: DigestPolicy;
  codec: DigestTokenCodec;
}
export interface DigestState {
  title: string;
  headings: DigestHeading[];
  tables: { position: number; headers: string[] }[];
  sections: { headingId: string | null; position: number; text: string }[];
}
export type DigestLogEntry =
  { kind: 'heading'; headingId: string; position: number; included: true } |
  { kind: 'block'; position: number; originalCharacters: number; includedCharacters: number; omittedCharacters: number };
export interface DigestResult {
  policyVersion: typeof DIGEST_POLICY_VERSION;
  tokenizerId: string;
  state: DigestState;
  serialized: string;
  tokenCount: number;
  notes: ('N_NO_OUTLINE' | 'N_NO_STRUCTURAL_SECTIONS')[];
  selectionLog: DigestLogEntry[];
}
export class DigestBudgetError extends Error {
  readonly code = 'E_DIGEST_OUTLINE_BUDGET';
  constructor() { super('Too large for the confidence check.'); }
}
const words = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
function structural(text: string, vocabulary: readonly string[]): boolean {
  const tokens = words(text);
  return vocabulary.some(term => {
    const target = words(term);
    return target.length > 0 && tokens.some((_, start) => target.every((token, offset) => tokens[start + offset] === token));
  });
}
function validPosition(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }

/** No implicit tokenizer or policy. The returned serialized state is the exact budgeted model state. */
export function buildDigest(input: DigestInput, options: DigestOptions): DigestResult {
  const { policy, codec, budget, vocabulary } = options;
  if (!policy || policy.version !== DIGEST_POLICY_VERSION || !policy.acceptedBy || !policy.acceptedAt) {
    throw new Error('Digest policy must be explicitly accepted in the project pack.');
  }
  if (!codec || !codec.id || codec.id !== policy.tokenizerId) throw new Error('Digest tokenizer does not match the project policy.');
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error('Digest token budget must be a positive integer.');
  const count = (value: string): number => {
    const tokens = codec.countTokens(value);
    if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error('Digest tokenizer returned an invalid token count.');
    return tokens;
  };
  const headings = input.headings.map(heading => ({ ...heading })).sort((a, b) => a.position - b.position);
  const ids = new Set<string>();
  for (const heading of headings) {
    if (!heading.id || ids.has(heading.id) || !heading.text || !Number.isSafeInteger(heading.level) || heading.level < 1 || !validPosition(heading.position)) {
      throw new Error('Invalid or duplicate digest heading.');
    }
    ids.add(heading.id);
  }
  const blocks = input.blocks.map(block => ({ ...block })).sort((a, b) => a.position - b.position);
  for (const block of blocks) {
    if (!validPosition(block.position) || (block.headingId !== undefined && !ids.has(block.headingId))) throw new Error('Invalid digest block position or heading reference.');
  }
  const tables = input.tables.map(table => ({ position: table.position, headers: [...table.headers] })).sort((a, b) => a.position - b.position);
  if (tables.some(table => !validPosition(table.position))) throw new Error('Invalid digest table position.');
  const title = input.title ?? headings[0]?.text ?? blocks[0]?.text;
  if (title === undefined) throw new Error('Digest has no title, heading, or text block.');
  const state: DigestState = { title, headings, tables, sections: [] };
  if (count(JSON.stringify(state)) > budget) throw new DigestBudgetError();
  const notes: DigestResult['notes'] = [];
  const priority = headings.filter(heading => structural(heading.text, vocabulary));
  if (!headings.length) notes.push('N_NO_OUTLINE');
  else if (!priority.length) notes.push('N_NO_STRUCTURAL_SECTIONS');
  const priorityIds = new Set(priority.map(heading => heading.id));
  const ordered = headings.length ? [
    ...priority.flatMap(heading => blocks.filter(block => block.headingId === heading.id)),
    ...headings.filter(heading => !priorityIds.has(heading.id)).flatMap(heading => blocks.filter(block => block.headingId === heading.id)),
    ...blocks.filter(block => block.headingId === undefined),
  ] : blocks;
  const selectionLog: DigestLogEntry[] = headings.map(heading => ({ kind: 'heading', headingId: heading.id, position: heading.position, included: true }));
  let exhausted = false;
  for (const block of ordered) {
    const section = { headingId: block.headingId ?? null, position: block.position, text: block.text };
    const fits = (prefix: string) => count(JSON.stringify({ ...state, sections: [...state.sections, { ...section, text: prefix }] })) <= budget;
    let selected = '';
    if (!exhausted && block.text.length > 0) {
      if (fits(block.text)) selected = block.text;
      else {
        selected = codec.prefixWithinBudget(block.text, fits);
        if (!block.text.startsWith(selected) || (selected.length > 0 && !fits(selected))) throw new Error('Digest codec returned an invalid prefix.');
        exhausted = true;
      }
    }
    if (selected.length > 0) state.sections.push({ ...section, text: selected });
    selectionLog.push({ kind: 'block', position: block.position, originalCharacters: block.text.length,
      includedCharacters: selected.length, omittedCharacters: block.text.length - selected.length });
  }
  const serialized = JSON.stringify(state);
  return { policyVersion: policy.version, tokenizerId: codec.id, state, serialized, tokenCount: count(serialized), notes, selectionLog };
}
