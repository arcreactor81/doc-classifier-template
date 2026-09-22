import { WorkflowEntrypoint,type WorkflowEvent,type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { requireProject } from '../config/project.ts';
import { buildDigest,DIGEST_POLICY_VERSION,DigestBudgetError,type DigestResult } from '../digest/digest.ts';
import { verifyRecoveredHeadings } from '../digest/recovery.ts';
import { buildConfidenceRequest,buildReaderRequest,buildRecoveryRequest,decodeConfidence,decodeReader,decodeRecovery } from '../vendors/requests.ts';
import type { ConfidenceOutput,ReaderOutput } from '../vendors/validate.ts';
import { decide,type Decision } from '../domain/decision.ts';
import { Runner,guard } from './execution.ts';
import { batchReader } from './batch-runner.ts';
import { Store } from './store.ts';
import { codecFor } from './capabilities.ts';
import { failure,ServerFailure } from './errors.ts';
import type { Upload } from './contracts.ts';
export interface DocumentParams {runId:string;fingerprint:string}
export class DocumentWorkflow extends WorkflowEntrypoint<Env,DocumentParams>{
 async run(event:WorkflowEvent<DocumentParams>,step:WorkflowStep):Promise<{decisionKey:string}|void>{
  const {runId,fingerprint}=event.payload,store=new Store(this.env),run=await store.run(runId);
  const runner=new Runner(this.env,run,fingerprint,step);
  try{
   await guard(this.env,store,runId);const pack=requireProject(JSON.parse(run.pack_json));
   const initial=await store.document(runId,fingerprint);if(initial.decision_json)return;
   if(!initial.input_key)throw new ServerFailure('E_INPUT_MISSING','blocker','Uploaded text is missing.');
   await runner.stage('started',async()=>{await this.env.DB.prepare("UPDATE documents SET status='running' WHERE run_id=? AND fingerprint=? AND status='uploaded'").bind(runId,fingerprint).run();return{inputKey:initial.input_key};});
   const upload=await store.json<Upload>(initial.input_key);
   if(upload.tokenCounts.readerInputTokens+pack.settings.readerMaxOutputTokens>pack.limits.readerContextTokens)throw new ServerFailure('E_READER_CONTEXT','document','The full text exceeds the reader context limit.');
   let outline=upload.outline;const notes:string[]=JSON.parse(initial.notes_json);
   if(upload.needsOutlineRecovery){
    const request=buildRecoveryRequest({pin:pack.pins.recovery,text:upload.fullText,effort:pack.settings.readerEffort,maxOutputTokens:pack.settings.recoveryMaxOutputTokens});
    const recoveryKey=await runner.vendor(request,pack,raw=>decodeRecovery(raw,pack.pins.recovery));
    const recovered=(await store.json<{value:{model:string;headings:string[]}}>(recoveryKey)).value;
    const verification=verifyRecoveredHeadings(upload.fullText,recovered.headings);
    await runner.stage('recovery-verification',async()=>verification);
    if(verification.verified.length){
     const headings=[...outline.headings],positions=new Set(headings.map(heading=>heading.position));
     for(const item of verification.verified)for(const position of item.positions)if(!positions.has(position)){headings.push({id:`recovered_${position}`,text:item.text,position,level:1});positions.add(position);}
     headings.sort((a,b)=>a.position-b.position);
     outline={...outline,headings,blocks:outline.blocks.map(block=>{const heading=headings.findLast(value=>value.position<=block.position);return{...block,...(heading?{headingId:heading.id}:{})};})};
     notes.push('N_OUTLINE_RECOVERED');
    }
   }
   const confidenceCodec=codecFor(pack.tokenizers.confidence.id);
   const digestKey=await runner.stage('digest',async()=>buildDigest(outline,{budget:pack.settings.digestBudget,vocabulary:pack.structuralVocabulary,codec:confidenceCodec,policy:{version:DIGEST_POLICY_VERSION,acceptedBy:pack.budget.approvedBy,acceptedAt:pack.budget.approvedAt,tokenizerId:confidenceCodec.id}}));
   const digest=await store.json<DigestResult>(digestKey);notes.push(...digest.notes);
   await this.env.DB.prepare('UPDATE documents SET digest_key=?,notes_json=? WHERE run_id=? AND fingerprint=?').bind(digestKey,JSON.stringify([...new Set(notes)]),runId,fingerprint).run();
   const confidenceRequest=buildConfidenceRequest({pin:pack.pins.confidence,typeFile:pack.typeFile,serializedDigest:digest.serialized});
   if(confidenceCodec.countTokens(confidenceRequest.body)>upload.tokenCounts.confidenceInputTokens)throw new ServerFailure('E_COST_INPUT_CHANGED','blocker','The final confidence request exceeds the confirmed token ceiling. Request a new estimate; the request was not sent.');
   const confidenceKey=await runner.vendor(confidenceRequest,pack,raw=>decodeConfidence(raw,pack.pins.confidence,pack.typeFile.types.map(type=>type.id)));
   await this.env.DB.prepare('UPDATE documents SET confidence_key=? WHERE run_id=? AND fingerprint=?').bind(confidenceKey,runId,fingerprint).run();
   const readerRequest=buildReaderRequest({pin:pack.pins.reader,typeFile:pack.typeFile,text:upload.fullText,effort:pack.settings.readerEffort,maxOutputTokens:pack.settings.readerMaxOutputTokens});
   const readerKey=run.mode==='batch'?await batchReader(runner,pack,readerRequest):await runner.vendor(readerRequest,pack,raw=>decodeReader(raw,pack.pins.reader,pack.typeFile.types.map(type=>type.id),upload.fullText));
   await this.env.DB.prepare('UPDATE documents SET reader_key=? WHERE run_id=? AND fingerprint=?').bind(readerKey,runId,fingerprint).run();
   const confidence=(await store.json<{value:ConfidenceOutput}>(confidenceKey)).value,reader=(await store.json<{value:ReaderOutput}>(readerKey)).value;
   const decisionKey=await runner.stage('decide',async()=>decide({typeIds:pack.typeFile.types.map(type=>type.id),threshold:run.threshold,failures:[],notes:[...new Set(notes)],confidence:{choice:confidence.choice,certainty:confidence.confidence,noul:confidence.nouls},readerYes:reader.verdicts.filter(verdict=>verdict.is_type).map(verdict=>verdict.type_id)}));
   const decision=await store.json<Decision>(decisionKey);
   await runner.stage('record-decision',async()=>{const updated=await this.env.DB.prepare("UPDATE documents SET status='complete',decision_json=? WHERE run_id=? AND fingerprint=? AND EXISTS(SELECT 1 FROM runs WHERE id=? AND status='running')").bind(JSON.stringify(decision),runId,fingerprint,runId).run();if(updated.meta.changes!==1)throw new ServerFailure('E_RUN_STOPPED','blocker','The run stopped before this decision could be recorded.');return{decisionKey};});
   await finalize(store,runId);return{decisionKey};
  }catch(error){
   const issue=error instanceof DigestBudgetError?new ServerFailure(error.code,'document',error.message):failure(error);
   if(issue.kind==='blocker')await store.halt(runId,{code:issue.code,message:issue.message});
   else{
    const pack=requireProject(JSON.parse(run.pack_json));const doc=await store.document(runId,fingerprint);
    const decision=decide({typeIds:pack.typeFile.types.map(type=>type.id),threshold:run.threshold,failures:[issue.code],notes:JSON.parse(doc.notes_json)});
    await this.env.DB.prepare("UPDATE documents SET status='complete',failure_json=?,decision_json=? WHERE run_id=? AND fingerprint=?").bind(JSON.stringify({code:issue.code,message:issue.message}),JSON.stringify(decision),runId,fingerprint).run();
    await store.event(runId,fingerprint,'document','failed',{code:issue.code,message:issue.message});await finalize(store,runId);
   }
   throw new NonRetryableError(issue.message,issue.code);
  }
 }
}
async function finalize(store:Store,runId:string):Promise<void>{
 await store.env.DB.prepare("UPDATE runs SET status='complete' WHERE id=? AND status='running' AND expected_count=(SELECT COUNT(*) FROM documents WHERE run_id=? AND status='complete')").bind(runId,runId).run();
}