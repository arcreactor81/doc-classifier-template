import type {CorrectionDiff,CorrectionManifestEntry} from '../correction/diff.ts';
import {buildReference,type LabelDecision,type ReferenceEntry} from '../correction/reference.ts';
import {compareReference} from '../correction/comparison.ts';
import type {CorrectionProposals} from '../correction/proposals.ts';
import {Store,now,type RunRow} from './store.ts';
import {ServerFailure} from './errors.ts';
export interface ReferenceRecord {id:string;sourceRunId:string;correctionId:string;definitionRevisionId:string;entries:ReferenceEntry[]}
interface ReferenceRow {id:string;source_run_id:string;correction_id:string;definition_revision_id:string;confirmed_by:string;labels_json:string}
function reject(message:string):never{throw new ServerFailure('E_FEEDBACK_REFERENCE','request',message);}
export function validateReferenceLineage(expected:string,actual:unknown):void{if(!expected||expected!==actual)reject('This run must use the category version confirmed with its feedback.');}
export function referenceEntriesFromStored(source:CorrectionManifestEntry[],diff:CorrectionDiff,types:string[],labels:LabelDecision[],folderLabels:Record<string,string>,ignored:string[]):ReferenceEntry[]{
 try{return buildReference(source,[...diff.confirmations,...diff.moves],types,labels,folderLabels,ignored);}catch(error){reject(error instanceof Error?error.message:'Invalid feedback labels.');}
}
async function sourceEntries(store:Store,run:RunRow):Promise<CorrectionManifestEntry[]>{
 const docs=await store.documents(run.id);if(!['complete','closed'].includes(run.status)||docs.length!==run.expected_count||docs.some(doc=>!doc.decision_json))reject('Feedback requires completed source results.');
 return docs.map(doc=>{const decision=JSON.parse(doc.decision_json!);return{fingerprint:doc.fingerprint,tag:doc.tag,originalFilename:doc.original_filename,destinationFolder:decision.destinationFolder,rule:decision.ruleId};});
}
export async function readStoredCorrection(store:Store,run:RunRow,correctionId:string){
 const row=await store.env.DB.prepare('SELECT result_key,raw_key FROM corrections WHERE id=? AND run_id=?').bind(correctionId,run.id).first<{result_key:string;raw_key:string}>();if(!row)reject('The saved correction does not belong to this run.');
 const saved=await store.json<{diff:CorrectionDiff;proposals:CorrectionProposals;proposalContext:unknown}>(row.result_key);
 const types=JSON.parse(run.pack_json).typeFile.types.map((type:{id:string})=>type.id) as string[];
 const referenceCandidates=referenceEntriesFromStored(await sourceEntries(store,run),saved.diff,types,[],{},saved.proposals.ignoredFolders);
 return{correctionId,...saved,referenceCandidates};
}
export async function saveReference(store:Store,run:RunRow,correctionId:string,actor:string,input:{definitionRevisionId:string;labels:LabelDecision[];folderLabels?:Record<string,string>}):Promise<ReferenceRecord>{
 if(run.actor!==actor)reject('Only the source run owner can confirm its labels.');
 if(!input||typeof input.definitionRevisionId!=='string'||!Array.isArray(input.labels)||input.folderLabels!==undefined&&(typeof input.folderLabels!=='object'||input.folderLabels===null||Array.isArray(input.folderLabels)))reject('Choose a category version and confirm document labels.');
 const revision=await store.env.DB.prepare('SELECT type_file_json FROM definition_revisions WHERE id=?').bind(input.definitionRevisionId).first<{type_file_json:string}>();if(!revision)reject('The selected category version does not exist.');
 const saved=await readStoredCorrection(store,run,correctionId);
 const entries=referenceEntriesFromStored(await sourceEntries(store,run),saved.diff,JSON.parse(revision.type_file_json).types.map((type:{id:string})=>type.id),input.labels,input.folderLabels??{},saved.proposals.ignoredFolders);
 const value={id:crypto.randomUUID(),sourceRunId:run.id,correctionId,definitionRevisionId:input.definitionRevisionId,entries};
 await store.env.DB.prepare('INSERT INTO feedback_references(id,source_run_id,correction_id,definition_revision_id,created_at,confirmed_by,labels_json) VALUES(?,?,?,?,?,?,?)').bind(value.id,run.id,correctionId,input.definitionRevisionId,now(),actor,JSON.stringify(entries)).run();return value;
}
export async function readReference(store:Store,id:string,actor:string):Promise<ReferenceRecord>{
 const row=await store.env.DB.prepare('SELECT * FROM feedback_references WHERE id=?').bind(id).first<ReferenceRow>();if(!row||row.confirmed_by!==actor)reject('The confirmed feedback is unavailable to this person.');
 return{id:row.id,sourceRunId:row.source_run_id,correctionId:row.correction_id,definitionRevisionId:row.definition_revision_id,entries:JSON.parse(row.labels_json)};
}
export async function linkReferenceToRun(store:Store,run:RunRow,referenceId:string,actor:string,revisionId:unknown):Promise<void>{
 const reference=await readReference(store,referenceId,actor);if(run.actor!==actor||run.id===reference.sourceRunId||run.status!=='uploading')reject('Feedback can only be linked to your new, unstarted run.');validateReferenceLineage(reference.definitionRevisionId,revisionId);
 await store.env.DB.prepare('INSERT INTO feedback_run_links(run_id,reference_id) VALUES(?,?)').bind(run.id,referenceId).run();
}
export async function comparisonForRun(store:Store,run:RunRow,actor:string){
 const link=await store.env.DB.prepare('SELECT reference_id FROM feedback_run_links WHERE run_id=?').bind(run.id).first<{reference_id:string}>();if(!link)return null;
 const reference=await readReference(store,link.reference_id,actor);if(run.actor!==actor)reject('The run belongs to a different person.');
 const documents=(await store.documents(run.id)).map(doc=>{const decision=doc.decision_json?JSON.parse(doc.decision_json):null;return{fingerprint:doc.fingerprint,destinationFolder:decision?.destinationFolder??null,rule:decision?.ruleId??null};});
 return{referenceId:reference.id,sourceRunId:reference.sourceRunId,correctionId:reference.correctionId,definitionRevisionId:reference.definitionRevisionId,runId:run.id,complete:['complete','closed'].includes(run.status),...compareReference(reference.entries,documents)};
}
