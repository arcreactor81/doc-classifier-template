export class ServerFailure extends Error {
  readonly code: string;
  readonly kind: 'blocker' | 'document' | 'request';
  readonly status: number;
  constructor(code: string, kind: 'blocker' | 'document' | 'request', detail: string, status = kind === 'request' ? 400 : 409) {
    super(detail); this.name = 'ServerFailure'; this.code = code; this.kind = kind; this.status = status;
  }
}
export function failure(error: unknown): ServerFailure {
  if (error instanceof ServerFailure) return error;
  if (error && typeof error === 'object' && 'code' in error && 'kind' in error) return new ServerFailure(String(error.code), error.kind === 'document' ? 'document' : 'blocker', error instanceof Error ? error.message : String(error));
  return new ServerFailure('E_INTERNAL', 'blocker', error instanceof Error ? error.message : String(error), 500);
}
export const serverCopy = {
  action: 'Send this sentence to your technical contact: The document classifier is blocked; please inspect the recorded error code and Health details.',
  notReady: 'The project is not ready to start a run.',
  headline: 'This action could not finish.',
  reasons: { stage_failed: 'A processing stage could not finish. Review the recorded failure before retrying in a new run.', document_notes: 'The document needs a person to review its recorded notes.', agreement_at_threshold: 'Both systems agree at or above the run threshold.', low_certainty: 'Both systems agree, but certainty is below the run threshold.', straddles_types: 'The reader found more than one matching type.', possible_new_type: 'Neither system found a matching type. Consider whether a new type is needed.', systems_disagree: 'The two systems disagree. Review this document first.' },
};