import { builderCopy as copy } from './copy.ts';

export interface BuilderEntry {
  fingerprint: string;
  originalFilename: string;
  tag: string;
  destinationFolder: string;
  rule: string;
  reasoningNote: string;
  confidenceCheck: { choice: string; certainty: number; noul: Record<string, number> } | null;
  reader: { typeId: string; isType: boolean; rationale: string; evidence: string[]; closestAlternative: string | null }[] | null;
}
export interface BuilderManifest { runId: string; entries: BuilderEntry[] }
export interface SourceFile { path: string; fingerprint: string; read(): Promise<Uint8Array> }
/** Implementations MUST create exclusively: writeNew must reject an existing path, never overwrite it. */
export interface Destination {
  read(path: string): Promise<Uint8Array | null>;
  writeNew(path: string, bytes: Uint8Array): Promise<void>;
}
export interface BuildOptions {
  naming: 'original' | 'short';
  destinationPrefix: string;
  maxPathLength: number;
  maxComponentLength: number;
}
export interface PlannedEntry { entry: BuilderEntry; path: string; sidecarPath: string | null }
export interface BuildPlan { runId: string; entries: PlannedEntry[]; warnings: { tag: string; path: string; message: string }[] }
export type BuildStatus = keyof typeof copy.statuses;
export interface EntryResult { tag: string; path: string; originalFilename: string; status: BuildStatus; details?: string }
export interface BuildResult { entries: EntryResult[]; complete: boolean; summaryPath: string }

function safeName(name: string): void {
  if (!name || name === '.' || name === '..' || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error(copy.invalidName);
}

export function planTree(manifest: BuilderManifest, options: BuildOptions): BuildPlan {
  if (!options.destinationPrefix.trim() || !Number.isSafeInteger(options.maxPathLength) || options.maxPathLength < 1
    || !Number.isSafeInteger(options.maxComponentLength) || options.maxComponentLength < 1) throw new Error(copy.invalidLimits);
  const tags = new Set<string>();
  const warnings: BuildPlan['warnings'] = [];
  const entries = manifest.entries.map((entry) => {
    for (const name of [entry.destinationFolder, entry.originalFilename, entry.tag]) safeName(name);
    if (!/^[a-f0-9]{64}$/.test(entry.fingerprint)) throw new Error(copy.invalidFingerprint);
    if (tags.has(entry.tag.toLowerCase())) throw new Error(copy.invalidTag);
    tags.add(entry.tag.toLowerCase());
    const dot = entry.originalFilename.lastIndexOf('.');
    const extension = dot > 0 ? entry.originalFilename.slice(dot) : '';
    const filename = options.naming === 'short' ? `${entry.tag}${extension}` : `${entry.tag}--${entry.originalFilename}`;
    const path = `${entry.destinationFolder}/${filename}`;
    const sidecarPath = ['human_review', 'could_not_process'].includes(entry.destinationFolder) ? `${path}.md` : null;
    const longest = sidecarPath ?? path;
    if (`${options.destinationPrefix}/${longest}`.length > options.maxPathLength
      || longest.split('/').some((part) => part.length > options.maxComponentLength)) {
      warnings.push({ tag: entry.tag, path: longest, message: copy.longPath });
    }
    return { entry, path, sidecarPath };
  });
  return { runId: manifest.runId, entries, warnings };
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', owned)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const encoder = new TextEncoder();
// HTML and Markdown escaping changes presentation only; vendor strings and numbers remain untouched in the manifest.
function markdown(value: string): string { return value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/[\\`*_[\]{}|]/g, '\\$&'); }
function jsonBlock(value: unknown): string {
  // Indented blocks cannot be terminated by model-supplied Markdown fences.
  return JSON.stringify(value, null, 2).split('\n').map((line) => `    ${line}`).join('\n');
}
export function renderSidecar(entry: BuilderEntry): string {
  return [
    `# ${copy.sidecarTitle}`, '', `${copy.originalFilename}: ${markdown(entry.originalFilename)}`,
    `${copy.tag}: ${markdown(entry.tag)}`, `${copy.fingerprint}: ${entry.fingerprint}`,
    `${copy.rule}: ${markdown(entry.rule)}`, '', `## ${copy.reasoning}`, '', markdown(entry.reasoningNote),
    '', `## ${copy.confidenceCheck}`, '', entry.confidenceCheck === null ? copy.missingVendor : jsonBlock(entry.confidenceCheck),
    '', `## ${copy.reader}`, '', entry.reader === null ? copy.missingVendor : jsonBlock(entry.reader),
    '', `## ${copy.decision}`, '', entry.destinationFolder === 'could_not_process' ? copy.failureDecision : copy.reviewDecision, '',
  ].join('\n');
}
function renderSummary(runId: string, entries: EntryResult[], complete: boolean): string {
  const counts = new Map<BuildStatus, number>();
  for (const entry of entries) counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
  return [`# ${copy.summaryTitle}`, '', `${copy.run}: ${markdown(runId)}`, '', complete ? copy.complete : copy.incomplete, '',
    ...Array.from(counts, ([status, count]) => `- ${copy.statuses[status]}: ${count}`), '',
    ...entries.map((entry) => `- ${markdown(entry.originalFilename)} → ${markdown(entry.path)}: ${copy.statuses[entry.status]}${entry.details ? ` — ${markdown(entry.details)}` : ''}`), '',
  ].join('\n');
}

/** Progress is reported in document counts. Restarting rechecks destination fingerprints and resumes safely. */
export async function buildTree(plan: BuildPlan, sources: SourceFile[], destination: Destination, options: {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number, result: EntryResult) => void;
} = {}): Promise<BuildResult> {
  if (plan.warnings.length) throw new Error(copy.longPath);
  const byFingerprint = new Map<string, SourceFile>();
  for (const source of [...sources].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    if (!byFingerprint.has(source.fingerprint)) byFingerprint.set(source.fingerprint, source);
  }
  const entries: EntryResult[] = [];
  for (const planned of plan.entries) {
    const { entry, path, sidecarPath } = planned;
    let status: BuildStatus = 'cancelled'; let details: string | undefined;
    if (!options.signal?.aborted) {
      try {
        const existing = await destination.read(path);
        if (existing !== null) {
          status = await sha256(existing) === entry.fingerprint ? 'already_present' : 'destination_conflict';
          if (status === 'destination_conflict') details = copy.conflict;
        } else {
          const source = byFingerprint.get(entry.fingerprint);
          if (!source) status = 'not_found';
          else {
            const bytes = await source.read();
            if (await sha256(bytes) !== entry.fingerprint) { status = 'source_changed'; details = copy.sourceChanged; }
            else { await destination.writeNew(path, bytes); status = 'copied'; }
          }
        }
        if (sidecarPath && ['copied', 'already_present'].includes(status)) {
          const content = encoder.encode(renderSidecar(entry));
          const previous = await destination.read(sidecarPath);
          if (previous === null) await destination.writeNew(sidecarPath, content);
          else if (await sha256(previous) !== await sha256(content)) { status = 'sidecar_conflict'; details = copy.sidecarConflict; }
        }
      } catch (error) {
        // A per-file failure is preserved in the returned results and immutable summary; later files continue.
        status = 'write_failed'; details = error instanceof Error ? error.message : String(error);
      }
    }
    const result: EntryResult = { tag: entry.tag, path, originalFilename: entry.originalFilename, status, ...(details ? { details } : {}) };
    entries.push(result);
    options.onProgress?.(entries.length, plan.entries.length, result);
  }
  const complete = entries.every((entry) => ['copied', 'already_present'].includes(entry.status));
  // Each invocation gets a new immutable report, including partial builds. Never overwrite an earlier summary.
  const summaryPath = `build-summary-${crypto.randomUUID()}.md`;
  await destination.writeNew(summaryPath, encoder.encode(renderSummary(plan.runId, entries, complete)));
  return { entries, complete, summaryPath };
}
