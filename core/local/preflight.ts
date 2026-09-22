import type { ProjectPack } from '../config/project.ts';
import { buildStructuredState,STRUCTURED_STATE_POLICY } from '../digest/structured-state.ts';
import type { LocalDocument } from './state.ts';
import { uiCopy } from '../ui/copy.ts';

export interface TokenCounts { readerInputTokens: number|null; confidenceInputTokens: number|null; recoveryInputTokens: number|null }
export interface QuoteDocument { fingerprint: string; originalFilename: string; tokenCounts: TokenCounts; needsOutlineRecovery: boolean; failed: boolean }
export interface PreparedDocument { local: LocalDocument; quote: QuoteDocument; upload: Record<string, unknown> }
export function prepareLocalRun(records: readonly LocalDocument[], pack: ProjectPack): PreparedDocument[] {
  if(pack.settings.confidenceStatePolicy!==STRUCTURED_STATE_POLICY)throw new Error('The structured-state policy must be explicit.');
  const seen = new Set<string>();
  return records.map(local => {
    if (seen.has(local.fingerprint)) throw new Error(uiCopy.duplicateContent);
    seen.add(local.fingerprint);
    if (local.state === 'not started') throw new Error(uiCopy.extractionIncomplete);
    const originalFilename = 'document' in local ? local.document.originalFilename : local.sourcePath.split('/').at(-1)!;
    const identity = { fingerprint: local.fingerprint, originalFilename };
    const failed = (failure: { code: string; message: string }): PreparedDocument => ({local, quote: {...identity, tokenCounts: {readerInputTokens: 0, confidenceInputTokens: 0, recoveryInputTokens: 0}, needsOutlineRecovery: false, failed: true}, upload: {...identity, failure}});
    if (local.state === 'could_not_process') return failed(local.failure);
    const document = local.document;

    buildStructuredState(document.fullText,document.outline,pack.structuralVocabulary);
    // No local billing estimate: the vendors report actual usage after each request.
    const tokenCounts: TokenCounts = {readerInputTokens: null, confidenceInputTokens: null, recoveryInputTokens: null};
    return {local, quote: {...identity, tokenCounts, needsOutlineRecovery: document.needsOutlineRecovery, failed: false}, upload: {...document, tokenCounts, tokenizerIds: {reader: null, confidence: null}}};
  });
}
