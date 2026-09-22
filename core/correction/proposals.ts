import type { CorrectionDiff, CorrectionMatch, CorrectionMove, CorrectionTreeFile } from './diff.ts';

export interface ProposalEvidence { certainty: number | null; agreedType: string | null; title: string; digestLines: readonly string[] }
export interface ProposalType { id: string; name: string }
export interface FolderDecision { folder: string; action: 'ignore' | 'new_type' }
export interface ProposalInput {
  correctionId: string;
  currentThreshold: number;
  minimumFiledCount: number;
  diff: CorrectionDiff;
  evidence: Record<string, ProposalEvidence>;
  types: readonly ProposalType[];
  folderDecisions: readonly FolderDecision[];
  /** UI copy is supplied centrally; this module never invents distinguishing content. */
  renderNotFor(from: ProposalType, to: ProposalType): string;
}
export interface ExampleCandidate { tag: string | null; title: string; digestLines: string[] }
export interface ThresholdProposal {
  correctionId: string;
  direction: 'raise' | 'lower';
  threshold: number;
  evidenceTags: string[];
}
export interface CorrectionProposals {
  filedCheck: { checked: number; wrong: number; correct: number; status: 'insufficient_sample' | 'no_errors' | 'cannot_separate' | 'raise_proposed' };
  raise: (ThresholdProposal & { wrongSentToReview: number; correctSentToReview: number }) | null;
  lower: (ThresholdProposal & { additionalAutomaticLabels: number; observedErrors: number }) | null;
  examples: (ExampleCandidate & { typeId: string })[];
  notFor: { fromType: string; toType: string; candidate: string; evidenceTags: string[] }[];
  newTypes: { folder: string; id: string | null; name: string; what: ''; not_for: ''; examples: ExampleCandidate[]; status: 'proposed_type_not_yet_defined' }[];
  unresolvedFolders: string[];
  unmatched: CorrectionTreeFile[];
  ignoredFolders: string[];
  moves: CorrectionMove[];
}
const unit = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
const proposedId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Produces inspectable proposals only. It neither applies a threshold nor edits a type file. */
export function proposeCorrections(input: ProposalInput): CorrectionProposals {
  if (!input.correctionId || !unit(input.currentThreshold) || !Number.isSafeInteger(input.minimumFiledCount) || input.minimumFiledCount < 1) {
    throw new Error('Invalid correction proposal policy or correction identity.');
  }
  const types = new Map(input.types.map(type => [type.id, type]));
  if (types.size !== input.types.length) throw new Error('Duplicate proposal type identity.');
  const unknown = new Set(input.diff.unknownFolders.map(item => item.folder));
  const decisions = new Map<string, FolderDecision['action']>();
  for (const decision of input.folderDecisions) {
    if (!unknown.has(decision.folder) || decisions.has(decision.folder) || !['ignore', 'new_type'].includes(decision.action)) {
      throw new Error('Invalid or duplicate unknown-folder decision.');
    }
    decisions.set(decision.folder, decision.action);
  }
  const evidence = (match: CorrectionMatch): ProposalEvidence => {
    const value = input.evidence[match.entry.tag];
    if (!value || (value.certainty !== null && !unit(value.certainty)) || (value.agreedType !== null && !types.has(value.agreedType))) throw new Error('Missing or invalid correction evidence.');
    return value;
  };
  const certainty = (match: CorrectionMatch): number => {
    const value = evidence(match).certainty;
    if (value === null) throw new Error('Recorded numeric certainty is required for threshold evidence.');
    return value;
  };
  const example = (match: CorrectionMatch): ExampleCandidate => {
    const value = evidence(match);
    return { tag: match.entry.tag, title: value.title, digestLines: [...value.digestLines] };
  };
  const included = (folder: string) => !unknown.has(folder) || decisions.get(folder) === 'new_type';
  const moves = input.diff.moves.filter(move => included(move.to));
  const confirmations = input.diff.confirmations.filter(match => included(match.file.folder));
  const filed = [...confirmations.filter(match => match.entry.rule === 'R1'), ...moves.filter(move => move.entry.rule === 'R1')];
  const correct = filed.filter(match => match.file.folder === match.entry.destinationFolder);
  const wrong = filed.filter(match => match.file.folder !== match.entry.destinationFolder);
  for (const match of filed) certainty(match);
  const enough = filed.length >= input.minimumFiledCount;
  const result: CorrectionProposals = {
    filedCheck: { checked: filed.length, wrong: wrong.length, correct: correct.length,
      status: !enough ? 'insufficient_sample' : wrong.length === 0 ? 'no_errors' : 'cannot_separate' },
    raise: null, lower: null, examples: [], notFor: [], newTypes: [],
    unresolvedFolders: input.diff.unknownFolders.filter(item => !decisions.has(item.folder)).map(item => item.folder),
    unmatched: input.diff.unmatched.filter(file => decisions.get(file.folder) !== 'ignore').map(file => ({ ...file })),
    ignoredFolders: input.folderDecisions.filter(decision => decision.action === 'ignore').map(decision => decision.folder),
    moves: input.diff.moves.map(move => ({ ...move, entry: { ...move.entry }, file: { ...move.file } })),
  };
  if (enough && wrong.length > 0 && correct.length > 0) {
    const maxWrong = Math.max(...wrong.map(match => certainty(match)));
    const minCorrect = Math.min(...correct.map(match => certainty(match)));
    if (maxWrong < minCorrect && minCorrect > input.currentThreshold) {
      result.filedCheck.status = 'raise_proposed';
      result.raise = { correctionId: input.correctionId, direction: 'raise', threshold: minCorrect,
        evidenceTags: filed.map(match => match.entry.tag), wrongSentToReview: wrong.length,
        correctSentToReview: correct.filter(match => certainty(match) < minCorrect).length };
    }
  }
  // An unmoved review item does not provide a type label, even in a checked folder.
  const reviewLabels = moves.filter(move => move.entry.rule === 'R2' &&
    move.entry.destinationFolder === 'human_review' && (types.has(move.to) || decisions.get(move.to) === 'new_type'));
  for (const match of reviewLabels) {
    certainty(match);
    if (evidence(match).agreedType === null) throw new Error('An R2 correction must retain the original agreed type.');
  }
  if (enough) {
    const candidates = [...new Set(reviewLabels.filter(match => match.to === evidence(match).agreedType)
      .map(match => certainty(match)).filter(certainty => certainty < input.currentThreshold))].sort((a, b) => a - b);
    for (const threshold of candidates) {
      const affected = reviewLabels.filter(match => certainty(match) >= threshold && certainty(match) < input.currentThreshold);
      const errors = reviewLabels.filter(match => certainty(match) >= threshold && match.to !== evidence(match).agreedType).length;
      if (affected.length > 0 && errors === 0) {
        result.lower = { correctionId: input.correctionId, direction: 'lower', threshold,
          evidenceTags: reviewLabels.map(match => match.entry.tag), additionalAutomaticLabels: affected.length, observedErrors: errors };
        break;
      }
    }
  }
  const seenExamples = new Set<string>();
  for (const match of [...confirmations, ...moves]) {
    if (!types.has(match.file.folder) || seenExamples.has(match.entry.tag)) continue;
    seenExamples.add(match.entry.tag);
    result.examples.push({ ...example(match), typeId: match.file.folder });
  }
  const pairs = new Map<string, { from: ProposalType; to: ProposalType; tags: string[] }>();
  for (const move of moves) {
    const from = types.get(move.from), to = types.get(move.to);
    if (!from || !to || from.id === to.id) continue;
    const key = JSON.stringify([from.id, to.id]);
    const pair = pairs.get(key) ?? { from, to, tags: [] };
    pair.tags.push(move.entry.tag);
    pairs.set(key, pair);
  }
  result.notFor = [...pairs.values()].map(pair => ({ fromType: pair.from.id, toType: pair.to.id,
    candidate: input.renderNotFor({ ...pair.from }, { ...pair.to }), evidenceTags: [...pair.tags] }));
  const proposedFolders = input.diff.unknownFolders.filter(item => decisions.get(item.folder) === 'new_type');
  const ids = proposedFolders.map(item => proposedId(item.folder));
  const reservedIds = new Set(['none_of_these', 'human_review', 'could_not_process']);
  result.newTypes = proposedFolders.map((item, index) => {
    const id = ids[index];
    const validId = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(id) && !types.has(id) && !reservedIds.has(id) && ids.filter(value => value === id).length === 1;
    const examples = item.files.map(file => {
      const match = moves.find(move => move.file.folder === file.folder && move.file.filename === file.filename);
      return match ? example(match) : { tag: null, title: file.filename, digestLines: [] };
    });
    return { folder: item.folder, id: validId ? id : null, name: item.folder, what: '', not_for: '', examples, status: 'proposed_type_not_yet_defined' };
  });
  return result;
}
