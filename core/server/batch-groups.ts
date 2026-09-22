import { ServerFailure } from './errors.ts';
export const GROUP_BYTES = 8 * 1024 * 1024;
export const SINGLE_BYTES = 32 * 1024 * 1024;
export interface BatchArtifact { fingerprint: string; request_key: string; bytes: number }
/** Metadata-only plan: never materialize all request bodies just to decide grouping. */
export function groupBatchArtifacts(rows: readonly BatchArtifact[]): BatchArtifact[][] {
  const groups: BatchArtifact[][] = [], seen = new Set<string>();
  let group: BatchArtifact[] = [], bytes = 0;
  for (const row of rows) {
    if (!row.fingerprint || !row.request_key || seen.has(row.fingerprint)) throw new ServerFailure('E_BATCH_GROUP', 'blocker', 'Missing or duplicate Batch artifact identity.');
    seen.add(row.fingerprint);
    if (!Number.isSafeInteger(row.bytes) || row.bytes < 1) throw new ServerFailure('E_BATCH_GROUP', 'blocker', 'Batch artifact size is invalid.');
    if (row.bytes > SINGLE_BYTES) throw new ServerFailure('E_BATCH_GROUP_MEMORY', 'blocker', 'A single Batch request artifact exceeds the supported memory envelope.');
    if (group.length && (bytes + row.bytes > GROUP_BYTES || group.length >= 50000)) { groups.push(group); group = []; bytes = 0; }
    group.push({ ...row }); bytes += row.bytes;
    if (row.bytes > GROUP_BYTES) { groups.push(group); group = []; bytes = 0; }
  }
  if (group.length) groups.push(group);
  return groups;
}
