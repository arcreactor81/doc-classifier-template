import type { DigestTokenCodec } from '../digest/digest.ts';
import { uiCopy } from '../ui/copy.ts';
/**
 * Code-reviewed, documented vendor codecs only. No guessed encoder or runtime registration.
 * Request-body countTokens MUST be verified against actual vendor billing serialization: messages,
 * instruction framing, schema/tool overhead and any other billed input. Ordinary BPE tokenization
 * of the JSON string is NOT sufficient. The confidence codec also counts the exact digest state.
 * A registration requires recorded evidence covering both contexts, not only vocabulary equivalence.
 */
const verifiedCodecs: ReadonlyMap<string, DigestTokenCodec> = new Map();
export function codecFor(id: string): DigestTokenCodec {
  const codec = verifiedCodecs.get(id);
  if (!codec) throw Object.assign(new Error(uiCopy.tokenizerUnavailable), { code: 'E_TOKENIZER_UNVERIFIED', kind: 'blocker' });
  return codec;
}
