import type { DigestTokenCodec } from '../digest/digest.ts';
import { uiCopy } from '../ui/copy.ts';
/** Official, versioned digest codecs only. Billing is monitored from vendor responses,
 * not inferred by tokenizing HTTP request JSON. No substitute Jev tokenizer is registered. */
const verifiedCodecs: ReadonlyMap<string, DigestTokenCodec> = new Map();
export function codecFor(id: string): DigestTokenCodec {
  const codec = verifiedCodecs.get(id);
  if (!codec) throw Object.assign(new Error(uiCopy.tokenizerUnavailable), { code: 'E_TOKENIZER_UNVERIFIED', kind: 'blocker' });
  return codec;
}
