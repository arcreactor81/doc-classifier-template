import type { ProjectPack } from '../config/project.ts';
import { buildDigest, DigestBudgetError, DIGEST_POLICY_VERSION, type DigestTokenCodec } from '../digest/digest.ts';
import { buildReaderRequest, buildConfidenceRequest } from '../vendors/requests.ts';
import type { LocalDocument } from './state.ts';
import { codecFor } from './tokenizers.ts';
import { uiCopy } from '../ui/copy.ts';

export interface TokenCounts { readerInputTokens: number; confidenceInputTokens: number; recoveryInputTokens: number }
export interface QuoteDocument { fingerprint: string; originalFilename: string; tokenCounts: TokenCounts; needsOutlineRecovery: boolean; failed: boolean }
export interface PreparedDocument { local: LocalDocument; quote: QuoteDocument; upload: Record<string, unknown> }
export function prepareLocalRun(records: readonly LocalDocument[], pack: ProjectPack, codecs?: { reader: DigestTokenCodec; confidence: DigestTokenCodec }): PreparedDocument[] {
  const selected = codecs ?? { reader: codecFor(pack.tokenizers.reader.id), confidence: codecFor(pack.tokenizers.confidence.id) };
  if (selected.reader.id !== pack.tokenizers.reader.id || selected.confidence.id !== pack.tokenizers.confidence.id) throw new Error(uiCopy.tokenizerUnavailable);
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
    if (document.needsOutlineRecovery) throw Object.assign(new Error(uiCopy.recoveryCeilingUnavailable), { code: 'E_RECOVERY_COST_BOUND_UNVERIFIED', kind: 'blocker' });
    let digest;
    try { digest = buildDigest(document.outline, {budget: pack.settings.digestBudget, vocabulary: pack.structuralVocabulary, codec: selected.confidence, policy: {version: DIGEST_POLICY_VERSION, acceptedBy: pack.budget.approvedBy, acceptedAt: pack.budget.approvedAt, tokenizerId: selected.confidence.id}}); }
    catch (error) { if (error instanceof DigestBudgetError) return failed({code: error.code, message: error.message}); throw error; }
    const reader = buildReaderRequest({pin: pack.pins.reader, typeFile: pack.typeFile, text: document.fullText, effort: pack.settings.readerEffort, maxOutputTokens: pack.settings.readerMaxOutputTokens});
    const confidence = buildConfidenceRequest({pin: pack.pins.confidence, typeFile: pack.typeFile, serializedDigest: digest.serialized});
    const tokenCounts = {readerInputTokens: selected.reader.countTokens(reader.body), confidenceInputTokens: selected.confidence.countTokens(confidence.body), recoveryInputTokens: 0};
    if (Object.values(tokenCounts).some(count => !Number.isSafeInteger(count) || count < 0)) throw new Error(uiCopy.tokenizerUnavailable);
    return {local, quote: {...identity, tokenCounts, needsOutlineRecovery: false, failed: false}, upload: {...document, tokenCounts, tokenizerIds: {reader: selected.reader.id, confidence: selected.confidence.id}}};
  });
}
