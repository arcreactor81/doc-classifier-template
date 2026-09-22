import type { ProjectPack } from '../config/project.ts';
import { buildDigest, DigestBudgetError, DIGEST_POLICY_VERSION, type DigestTokenCodec } from '../digest/digest.ts';
import type { LocalDocument } from './state.ts';
import { codecFor } from './tokenizers.ts';
import { uiCopy } from '../ui/copy.ts';

export interface TokenCounts { readerInputTokens: number|null; confidenceInputTokens: number|null; recoveryInputTokens: number|null }
export interface QuoteDocument { fingerprint: string; originalFilename: string; tokenCounts: TokenCounts; needsOutlineRecovery: boolean; failed: boolean }
export interface PreparedDocument { local: LocalDocument; quote: QuoteDocument; upload: Record<string, unknown> }
export function prepareLocalRun(records: readonly LocalDocument[], pack: ProjectPack, codecs?: { reader?: DigestTokenCodec; confidence: DigestTokenCodec }): PreparedDocument[] {
  const selected = codecs ?? { confidence: codecFor(pack.tokenizers.confidence.id) };
  if (selected.confidence.id !== pack.tokenizers.confidence.id) throw new Error(uiCopy.tokenizerUnavailable);
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

    try { if (!document.needsOutlineRecovery) buildDigest(document.outline, {budget: pack.settings.digestBudget, vocabulary: pack.structuralVocabulary, codec: selected.confidence, policy: {version: DIGEST_POLICY_VERSION, acceptedBy: pack.tokenizers.confidence.source, acceptedAt: pack.tokenizers.confidence.verifiedAt, tokenizerId: selected.confidence.id}}); }
    catch (error) { if (error instanceof DigestBudgetError) return failed({code: error.code, message: error.message}); throw error; }
    // No local billing estimate: the vendors report actual usage after each request.
    const tokenCounts: TokenCounts = {readerInputTokens: null, confidenceInputTokens: null, recoveryInputTokens: null};
    return {local, quote: {...identity, tokenCounts, needsOutlineRecovery: document.needsOutlineRecovery, failed: false}, upload: {...document, tokenCounts, tokenizerIds: {reader: null, confidence: selected.confidence.id}}};
  });
}
