import {CorrectionValidationError,type CorrectionValidationCode} from '../correction/diff.ts';
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
  if (error instanceof CorrectionValidationError) return new ServerFailure(error.code, error.code === 'E_CORRECTION_MANIFEST_IDENTITY' ? 'blocker' : 'request', error.message);
  if (error && typeof error === 'object' && 'code' in error && 'kind' in error) return new ServerFailure(String(error.code), error.kind === 'document' ? 'document' : 'blocker', error instanceof Error ? error.message : String(error));
  return new ServerFailure('E_INTERNAL', 'blocker', error instanceof Error ? error.message : String(error), 500);
}
export const serverCopy = {
  action: 'Send this sentence to your technical contact: The document classifier is blocked; please inspect the recorded error code and Health details.',
  corrections: {
    E_CORRECTION_ROOT_FOLDER: {headline: 'Choose the main output folder for corrections.', action: 'Select the folder containing the document-type folders. Put each document inside its intended folder, then choose the output folder again.'},
    E_CORRECTION_AMBIGUOUS_IDENTITY: {headline: 'A document appears more than once.', action: 'Keep one copy of each document in its intended folder inside the output folder. Move any extra copy outside that folder, then choose the output folder again.'},
    E_CORRECTION_DUPLICATE_PATH: {headline: 'The same file was listed more than once.', action: 'Choose the main output folder again to refresh the file list, then review the corrections.'},
    E_CORRECTION_PATH: {headline: 'The selected folder list could not be read.', action: 'Choose the main output folder containing the document-type folders again, then review the corrections.'},
    E_CORRECTION_MANIFEST_IDENTITY: {headline: 'The saved results contain conflicting document identifiers.', action: 'Send this sentence to your technical contact: The saved classification results contain missing or duplicate document identifiers; please inspect the recorded correction error code.'},
  } satisfies Record<CorrectionValidationCode,{headline:string;action:string}>,
  notReady: 'The project is not ready to start a run.',
  headline: 'This action could not finish.',
  reasons: { stage_failed: 'A processing stage could not finish. Review the recorded failure before retrying in a new run.', document_notes: 'The document needs a person to review its recorded notes.', agreement_at_threshold: 'Both systems agree at or above the run threshold.', low_certainty: 'Both systems agree, but certainty is below the run threshold.', straddles_types: 'The reader found more than one matching type.', possible_new_type: 'Neither system found a matching type. Consider whether a new type is needed.', systems_disagree: 'The two systems disagree. Review this document first.' },
};
export function failureResponse(issue:ServerFailure){
  const copy=Object.hasOwn(serverCopy.corrections,issue.code)?serverCopy.corrections[issue.code as CorrectionValidationCode]:undefined;
  return {error:{code:issue.code,kind:issue.kind,headline:copy?.headline??(issue.code==='E_INTERNAL'?serverCopy.headline:issue.message),action:copy?.action??serverCopy.action,details:{message:issue.code==='E_INTERNAL'?'An internal operation failed. The run must be reviewed before continuing.':issue.message}}};
}
