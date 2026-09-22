import { requireProject,typeVersion,type ProjectPack } from '../config/project.ts';
import { authorizeRunBudget,readRunBudget } from '../cost/run-budget.ts';
import { buildDigest,DIGEST_POLICY_VERSION,type DigestResult } from '../digest/digest.ts';
import { VENDOR_PROMPTS } from '../vendors/requests.ts';
import type { ConfidenceOutput,ReaderOutput } from '../vendors/validate.ts';
import { decide,type Decision } from '../domain/decision.ts';
import type { BuilderManifest,BuilderEntry } from '../builder/builder.ts';
import { diffCorrection,type CorrectionTreeFile } from '../correction/diff.ts';
import { proposeCorrections,type CorrectionProposals,type FolderDecision,type ProposalEvidence } from '../correction/proposals.ts';
import { actorFor } from './auth.ts';
import { health,projectSource,requireReady } from './health.ts';
import { codecFor,EXECUTION_ATTEMPTS } from './capabilities.ts';
import { Store,shaText,now,type RunRow } from './store.ts';
import { object,requireValue,exact,identity,jsonBody,parseUpload,validateManifestReady,type Upload } from './contracts.ts';
import { ServerFailure,failure,serverCopy } from './errors.ts';

function response(value:unknown,status=200):Response{return Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});}
async function authorizeRun(store:Store,id:string,actor:string):Promise<RunRow>{const run=await store.run(id);if(run.actor!==actor)throw new ServerFailure('E_RUN_FORBIDDEN','request','This run belongs to a different signed-in person.',403);return run;}
interface QuoteDocument {fingerprint:string;originalFilename:string;tokenCounts:{readerInputTokens:number|null;confidenceInputTokens:number|null;recoveryInputTokens:number|null};needsOutlineRecovery:boolean;failed:boolean}
export async function manifestFor(store:Store,run:RunRow):Promise<BuilderManifest>{
 const documents=await store.documents(run.id);validateManifestReady(run.status,run.expected_count,documents.filter(doc=>doc.decision_json!==null).length);
 if(run.manifest_key)return store.json<BuilderManifest>(run.manifest_key);
 const entries:(BuilderEntry & {vendorOutputs:{confidence:ConfidenceOutput|null;reader:ReaderOutput|null};extraction:unknown;notes:string[];outlineRecovered:boolean})[]=[];
 for(const document of documents){
  const decision=JSON.parse(document.decision_json!) as Decision;
  const confidence=document.confidence_key?(await store.json<{value:ConfidenceOutput}>(document.confidence_key)).value:null;
  const reader=document.reader_key?(await store.json<{value:ReaderOutput}>(document.reader_key)).value:null;
  entries.push({vendorOutputs:{confidence,reader},extraction:document.extraction_json?JSON.parse(document.extraction_json):null,notes:JSON.parse(document.notes_json),outlineRecovered:(JSON.parse(document.notes_json) as string[]).includes('N_OUTLINE_RECOVERED'),fingerprint:document.fingerprint,originalFilename:document.original_filename,tag:document.tag,destinationFolder:decision.destinationFolder,rule:decision.ruleId,reasoningNote:serverCopy.reasons[decision.reasonCode],confidenceCheck:confidence?{choice:confidence.choice,certainty:confidence.confidence,noul:{...confidence.nouls}}:null,reader:reader?reader.verdicts.map(v=>({typeId:v.type_id,isType:v.is_type,rationale:v.rationale,evidence:[...v.evidence],closestAlternative:v.closest_alternative})):null});
 }
 const value={runId:run.id,entries,pins:(JSON.parse(run.pack_json) as ProjectPack).pins,typeVersion:run.type_version,threshold:run.threshold,mode:run.mode,notes:documents.map(document=>({fingerprint:document.fingerprint,notes:JSON.parse(document.notes_json),failure:document.failure_json?JSON.parse(document.failure_json):null}))};
 const key=await store.put(run.id,null,'manifest',value);
 await store.env.DB.prepare('UPDATE runs SET manifest_key=? WHERE id=? AND manifest_key IS NULL').bind(key,run.id).run();return value;
}
async function quote(request:Request,env:Env,store:Store,actor:string):Promise<Response>{
 await requireReady(env);const pack=requireProject(projectSource),raw=await jsonBody(request);
 requireValue(object(raw),'A quote request is required.');exact(raw,['documents','mode']);requireValue(raw.mode==='interactive'||raw.mode==='batch','Select a run mode.');requireValue(Array.isArray(raw.documents)&&raw.documents.length>0,'Choose at least one document.');
 const ids=new Set<string>();const docs:QuoteDocument[]=[];
 for(const value of raw.documents){
  requireValue(object(value),'Invalid preflight document.');exact(value,['fingerprint','originalFilename','tokenCounts','needsOutlineRecovery','failed']);identity(value);
  requireValue(!ids.has(String(value.fingerprint)),'Duplicate document fingerprints are not allowed in a run.');ids.add(String(value.fingerprint));
  requireValue(typeof value.needsOutlineRecovery==='boolean'&&typeof value.failed==='boolean'&&object(value.tokenCounts),'Explicit recovery state and token-count availability are required.');exact(value.tokenCounts,['readerInputTokens','confidenceInputTokens','recoveryInputTokens']);requireValue(Object.values(value.tokenCounts).every(v=>v===null||Number.isSafeInteger(v)&&Number(v)>=0),'Invalid token counts.');
  docs.push(value as unknown as QuoteDocument);
 }
 const id=crypto.randomUUID(),version=await typeVersion(JSON.stringify(pack.typeFile));
 await env.DB.prepare('INSERT INTO quotes(id,actor,created_at,mode,type_version,pack_hash,request_json,estimate_json) VALUES(?,?,?,?,?,?,?,?)').bind(id,actor,now(),raw.mode,version,await shaText(JSON.stringify({pack,prompts:VENDOR_PROMPTS,build:env.BUILD_COMMIT,attempts:EXECUTION_ATTEMPTS})),JSON.stringify(docs),JSON.stringify({policy:'reported_usage',version:1})).run();
 return response({quoteId:id,typeVersion:version,mode:raw.mode});
}
async function createRun(request:Request,env:Env,store:Store,actor:string):Promise<Response>{
 await requireReady(env);const raw=await jsonBody(request);requireValue(object(raw),'A run request is required.');exact(raw,['quoteId','budget']);requireValue(typeof raw.quoteId==='string','A preflight confirmation and explicit budget decision are required.');
 const pack=requireProject(projectSource),quote=await env.DB.prepare('SELECT * FROM quotes WHERE id=? AND actor=?').bind(raw.quoteId,actor).first<{id:string;mode:'interactive'|'batch';type_version:string;pack_hash:string;request_json:string;estimate_json:string}>();requireValue(quote,'The preflight confirmation is not available to this person.');
 requireValue(quote.pack_hash===await shaText(JSON.stringify({pack,prompts:VENDOR_PROMPTS,build:env.BUILD_COMMIT,attempts:EXECUTION_ATTEMPTS}))&&quote.type_version===await typeVersion(JSON.stringify(pack.typeFile)),'The project changed after this confirmation. Confirm the run again.');
 const docs=JSON.parse(quote.request_json) as QuoteDocument[];
 let budget:ReturnType<typeof authorizeRunBudget>;
 try{budget=authorizeRunBudget(raw.budget,actor,now());}catch(error){throw new ServerFailure('E_RUN_BUDGET','request',error instanceof Error?error.message:'Invalid run budget.');}
 const prior=await env.DB.prepare('SELECT id,budget_json FROM runs WHERE quote_id=?').bind(quote.id).first<{id:string;budget_json:string}>();
 if(prior){const existing=readRunBudget(JSON.parse(prior.budget_json));requireValue(existing.mode===budget.mode&&existing.unlimitedAcknowledged===budget.unlimitedAcknowledged&&JSON.stringify(existing.limits)===JSON.stringify(budget.limits),'This confirmation already created a run with a different spending decision. Confirm a new run to change limits.');return response({runId:prior.id});}
 const control=await env.DB.prepare('SELECT threshold,threshold_justification FROM controls WHERE id=1').first<{threshold:number;threshold_justification:string}>();if(!control)throw new ServerFailure('E_STORAGE_D1','blocker','Run controls are missing.');
 const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO runs(id,actor,status,created_at,mode,expected_count,threshold,threshold_justification,type_version,pack_json,budget_json,quote_id) VALUES(?,?,'uploading',?,?,?,?,?,?,?,?,?)").bind(id,actor,now(),quote.mode,docs.length,control.threshold,control.threshold_justification,quote.type_version,JSON.stringify(pack),JSON.stringify(budget),quote.id).run();
 await store.event(id,null,'run','created',{budget,mode:quote.mode});return response({runId:id},201);
}
export function verifyUploadTokens(upload:Upload,pack:ProjectPack):void{
 const confidenceCodec=codecFor(pack.tokenizers.confidence.id);
 requireValue(upload.tokenizerIds.confidence===confidenceCodec.id,'Uploaded digest tokenizer does not match the project.');
 if(!upload.needsOutlineRecovery)buildDigest(upload.outline,{budget:pack.settings.digestBudget,vocabulary:pack.structuralVocabulary,codec:confidenceCodec,policy:{version:DIGEST_POLICY_VERSION,acceptedBy:pack.tokenizers.confidence.source,acceptedAt:pack.tokenizers.confidence.verifiedAt,tokenizerId:confidenceCodec.id}});
}
async function uploadDocument(request:Request,env:Env,store:Store,run:RunRow):Promise<Response>{
 requireValue(run.status==='uploading','This run is no longer accepting uploads.');const pack=requireProject(JSON.parse(run.pack_json));const raw=await jsonBody(request);requireValue(object(raw),'A document object is required.');identity(raw);
 const hash=await shaText(JSON.stringify(raw));const previous=await env.DB.prepare('SELECT input_hash FROM documents WHERE run_id=? AND fingerprint=?').bind(run.id,raw.fingerprint).first<{input_hash:string}>();if(previous){requireValue(previous.input_hash===hash,'An upload with this fingerprint already exists with different content.');return response({uploaded:true,idempotent:true});}
 const quoted=await env.DB.prepare('SELECT request_json FROM quotes WHERE id=(SELECT quote_id FROM runs WHERE id=?)').bind(run.id).first<{request_json:string}>();const docs=JSON.parse(quoted!.request_json) as QuoteDocument[];const index=docs.findIndex(doc=>doc.fingerprint===raw.fingerprint);requireValue(index>=0,'The document was not included in the confirmed preflight.');const expected=docs[index];requireValue(raw.originalFilename===expected.originalFilename,'The filename differs from the confirmed preflight.');
 let key:string|null=null,extractor:string|null=null,extraction:string|null=null,decision:Decision|null=null,failed:unknown=null;
 if(Object.hasOwn(raw,'failure')){exact(raw,['fingerprint','originalFilename','failure']);requireValue(expected.failed&&object(raw.failure),'The quote must record the local extraction failure.');exact(raw.failure,['code','message']);requireValue(typeof raw.failure.code==='string'&&typeof raw.failure.message==='string','Invalid extraction failure.');failed=raw.failure;decision=decide({typeIds:pack.typeFile.types.map(type=>type.id),threshold:run.threshold,failures:[raw.failure.code],notes:[]});}
 else{
  const document=parseUpload(raw);requireValue(!expected.failed&&JSON.stringify(document.tokenCounts)===JSON.stringify(expected.tokenCounts)&&document.needsOutlineRecovery===expected.needsOutlineRecovery,'The document differs from the confirmed preflight input.');verifyUploadTokens(document,pack);extractor=document.extractorVersion;extraction=JSON.stringify({extractorVersion:document.extractorVersion,parserVersions:document.parserVersions,needsOutlineRecovery:document.needsOutlineRecovery});key=await store.put(run.id,document.fingerprint,'input',document,true);
 }
 await env.DB.prepare("INSERT INTO documents(run_id,fingerprint,tag,original_filename,status,input_key,input_hash,extractor_version,decision_json,failure_json,extraction_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(run.id,raw.fingerprint,`r${run.id.slice(0,8)}-${String(index+1).padStart(4,'0')}`,raw.originalFilename,decision?'complete':'uploaded',key,hash,extractor,decision?JSON.stringify(decision):null,failed?JSON.stringify(failed):null,extraction).run();
 await store.event(run.id,String(raw.fingerprint),'upload','completed',{failed:decision!==null});return response({uploaded:true,idempotent:false},201);
}
async function start(env:Env,store:Store,run:RunRow):Promise<Response>{
 await requireReady(env);requireValue(['uploading','running'].includes(run.status),'This run cannot start again.');const docs=await store.documents(run.id);requireValue(docs.length===run.expected_count,'Every document must be uploaded before starting.');
 if(run.status==='uploading'){
  const mixed=new Set(docs.map(doc=>doc.extractor_version).filter(Boolean)).size>1;
  if(mixed)for(const doc of docs)await env.DB.prepare('UPDATE documents SET notes_json=? WHERE run_id=? AND fingerprint=?').bind(JSON.stringify(['N_EXTRACTOR_VERSION_MIXED']),run.id,doc.fingerprint).run();
  await env.DB.prepare("UPDATE runs SET status='running' WHERE id=? AND status='uploading'").bind(run.id).run();
 }
 let started=0;for(const doc of docs.filter(doc=>doc.status!=='complete'&&doc.workflow_id===null).slice(0,50)){
  const id=`${run.id}-${doc.fingerprint}`;
  try{await env.DOCUMENT_WORKFLOW.create({id,params:{runId:run.id,fingerprint:doc.fingerprint}});await env.DB.prepare('UPDATE documents SET workflow_id=? WHERE run_id=? AND fingerprint=?').bind(id,run.id,doc.fingerprint).run();started++;}
  catch(error){await store.halt(run.id,{code:'E_WORKFLOW_START',detail:failure(error).message});throw new ServerFailure('E_WORKFLOW_START','blocker','A document workflow could not be started. The run has halted.');}
 }
 const pending=(await store.documents(run.id)).filter(doc=>doc.status!=='complete'&&doc.workflow_id===null).length;
 if(docs.every(doc=>doc.status==='complete'))await env.DB.prepare("UPDATE runs SET status='complete' WHERE id=? AND status='running'").bind(run.id).run();
 return response({started,pending});
}
async function corrections(request:Request,env:Env,store:Store,run:RunRow,actor:string):Promise<Response>{
 const raw=await jsonBody(request);requireValue(object(raw),'A correction listing is required.');requireValue(Object.keys(raw).every(key=>['files','checkedFolders','sidecarPaths','folderDecisions'].includes(key)),'Only a local file listing may be submitted.');requireValue(Array.isArray(raw.files)&&Array.isArray(raw.checkedFolders)&&raw.checkedFolders.every(v=>typeof v==='string')&&Array.isArray(raw.sidecarPaths)&&raw.sidecarPaths.every(v=>typeof v==='string'),'Invalid correction listing.');
 for(const file of raw.files){requireValue(object(file)&&Object.keys(file).every(key=>['folder','filename','tag','fingerprint'].includes(key))&&typeof file.folder==='string'&&typeof file.filename==='string','A correction may contain paths and identities only.');}
 const manifest=await manifestFor(store,run),pack=requireProject(JSON.parse(run.pack_json));const diff=diffCorrection({manifest:manifest.entries,files:raw.files as CorrectionTreeFile[],checkedFolders:raw.checkedFolders as string[],sidecarPaths:raw.sidecarPaths as string[],typeFolders:pack.typeFile.types.map(type=>type.id)});
 const evidence:Record<string,ProposalEvidence>={};for(const doc of await store.documents(run.id)){
  const conf=doc.confidence_key?(await store.json<{value:ConfidenceOutput}>(doc.confidence_key)).value:null;const digest=doc.digest_key?await store.json<DigestResult>(doc.digest_key):null;
  evidence[doc.tag]={certainty:conf?.confidence??null,agreedType:conf&&JSON.parse(doc.decision_json!).ruleId==='R2'?conf.choice:null,title:digest?.state.title??doc.original_filename,digestLines:digest?.state.sections.map(section=>section.text)??[]};
 }
 const id=crypto.randomUUID();const proposals=proposeCorrections({correctionId:id,currentThreshold:run.threshold,minimumFiledCount:pack.settings.minimumFiledCount,diff,evidence,types:pack.typeFile.types,folderDecisions:(raw.folderDecisions??[]) as FolderDecision[],renderNotFor:(from,to)=>`${from.name}: review the distinction from ${to.name} using the corrected documents.`});
 const rawKey=await store.put(run.id,null,'correction_input',raw),resultKey=await store.put(run.id,null,'correction_analysis',{diff,proposals});
 await env.DB.prepare('INSERT INTO corrections(id,run_id,actor,created_at,raw_key,result_key,proposals_json) VALUES(?,?,?,?,?,?,?)').bind(id,run.id,actor,now(),rawKey,resultKey,JSON.stringify(proposals)).run();return response({correctionId:id,diff,proposals});
}
export async function handle(request:Request,env:Env):Promise<Response>{
 try{
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/health'&&request.method==='GET')return response(await health(env));
  if(path==='/api/project'&&request.method==='GET')return response(projectSource);
  if(!path.startsWith('/api/'))return await env.ASSETS.fetch(request);
  const actor=await actorFor(request,env),store=new Store(env);
  if(path==='/api/quote'&&request.method==='POST')return await quote(request,env,store,actor);
  if(path==='/api/runs'&&request.method==='POST')return await createRun(request,env,store,actor);
  if(path==='/api/runs'&&request.method==='GET'){
   const rows=(await env.DB.prepare('SELECT * FROM runs WHERE actor=? ORDER BY created_at DESC').bind(actor).all<RunRow>()).results;const runs=[];
   for(const run of rows){const docs=await store.documents(run.id),spend=await store.spendByVendor(run.id);runs.push({id:run.id,status:run.status,createdAt:run.created_at,total:run.expected_count,completed:docs.filter(doc=>doc.status==='complete').length,spendNano:spend.blended,spend,budget:readRunBudget(JSON.parse(run.budget_json)),unaccountedCalls:await store.unaccounted(run.id),pendingAccounting:await store.pendingAccounting(run.id),textHeld:!!run.text_held,mode:run.mode});}return response({runs});
  }
  if(path==='/api/kill'&&request.method==='POST'){
   const raw=await jsonBody(request);requireValue(object(raw),'An explicit switch state is required.');exact(raw,['enabled']);requireValue(typeof raw.enabled==='boolean','An explicit switch state is required.');await env.DB.prepare('UPDATE controls SET kill=? WHERE id=1').bind(raw.enabled?1:0).run();
   if(raw.enabled)await env.DB.prepare("UPDATE runs SET status='halted',halt_json=? WHERE status IN('running','uploading')").bind(JSON.stringify({code:'E_KILL_SWITCH',actor})).run();await store.event(null,null,'kill_switch','changed',{enabled:raw.enabled,actor});return response({enabled:raw.enabled});
  }
  const match=/^\/api\/runs\/([^/]+)(?:\/(.*))?$/.exec(path);if(!match)throw new ServerFailure('E_ROUTE','request','This API route does not exist.',404);
  const run=await authorizeRun(store,match[1],actor),action=match[2];
  if(!action&&request.method==='GET'){const documents=await store.documents(run.id),spend=await store.spendByVendor(run.id),events=(await env.DB.prepare('SELECT * FROM events WHERE run_id=? ORDER BY created_at').bind(run.id).all()).results;return response({run:{id:run.id,status:run.status,createdAt:run.created_at,total:run.expected_count,completed:documents.filter(doc=>doc.status==='complete').length,mode:run.mode,textHeld:!!run.text_held,spendNano:spend.blended,spend,budget:readRunBudget(JSON.parse(run.budget_json)),unaccountedCalls:await store.unaccounted(run.id),pendingAccounting:await store.pendingAccounting(run.id),threshold:run.threshold},documents:documents.map(doc=>({...doc,decision:doc.decision_json?JSON.parse(doc.decision_json):null})),events});}
  if(action==='documents'&&request.method==='POST')return await uploadDocument(request,env,store,run);
  if(action==='start'&&request.method==='POST')return await start(env,store,run);
  if(action==='close'&&request.method==='POST'){await store.close(run.id,actor);return response({closed:true});}
  if(action==='manifest'&&request.method==='GET'){const manifest=await manifestFor(store,run);await store.close(run.id,actor);return new Response(JSON.stringify(manifest,null,2),{headers:{'content-type':'application/json','content-disposition':`attachment; filename="${run.id}-manifest.json"`,'cache-control':'no-store'}});}
  if(action==='corrections'&&request.method==='POST')return await corrections(request,env,store,run,actor);
  const apply=/^corrections\/([^/]+)\/apply$/.exec(action??'');
  if(apply&&request.method==='POST'){
   const raw=await jsonBody(request);requireValue(object(raw),'A threshold decision is required.');exact(raw,['direction','threshold']);requireValue(raw.direction==='raise'||raw.direction==='lower','Select a stored proposal.');
   const correction=await env.DB.prepare('SELECT proposals_json FROM corrections WHERE id=? AND run_id=?').bind(apply[1],run.id).first<{proposals_json:string}>();requireValue(correction,'The correction does not exist.');const proposal=(JSON.parse(correction.proposals_json) as CorrectionProposals)[raw.direction];requireValue(proposal&&proposal.threshold===raw.threshold,'Only the exact stored threshold proposal may be applied.');
   await env.DB.batch([env.DB.prepare('INSERT INTO threshold_history(id,correction_id,actor,created_at,threshold,direction) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),apply[1],actor,now(),raw.threshold,raw.direction),env.DB.prepare('UPDATE controls SET threshold=?,threshold_justification=? WHERE id=1').bind(raw.threshold,apply[1])]);return response({applied:true,threshold:raw.threshold,correctionId:apply[1]});
  }
  throw new ServerFailure('E_ROUTE','request','This API route does not exist.',404);
 }catch(error){const issue=failure(error);return response({error:{code:issue.code,kind:issue.kind,headline:issue.code==='E_INTERNAL'?serverCopy.headline:issue.message,action:serverCopy.action,details:{message:issue.code==='E_INTERNAL'?'An internal operation failed. The run must be reviewed before continuing.':issue.message}}},issue.status);}
}