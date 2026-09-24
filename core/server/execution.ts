import {checkSpendAdmission,unknownSpendPolicy} from '../cost/spend-admission.ts';
import {ValidationFailure} from '../vendors/validate.ts';
import {readerEvidencePolicy} from '../vendors/evidence-policy.ts';
import {providerScope,readProviderCooldown,observeProviderCooldown,awaitProviderAdmission} from './provider-cooldown.ts';
import type { WorkflowStep } from 'cloudflare:workers';
import type { ProjectPack } from '../config/project.ts';
import { actualUsageCost } from '../cost/cost.ts';
import { readRunBudget } from '../cost/run-budget.ts';
import { executeVendor, type CallLog, type RawAttempt, type TransportDependencies } from '../vendors/transport.ts';
import { verifyModelPolicy,type FrozenVendorRequest,type VendorRole } from '../vendors/requests.ts';
import { Store,now,type RunRow } from './store.ts';
import { checkpoint } from './checkpoint.ts';
import { workflowReference } from './workflow-ack.ts';
import { workflowWait } from './workflow-wait.ts';
import { assertWorkflowGeneration } from './workflow-generation.ts';
import { pricingFor } from './capabilities.ts';
import { ServerFailure } from './errors.ts';
export async function guard(env:Env,store:Store,runId:string):Promise<void>{
 const controls=await env.DB.prepare('SELECT kill FROM controls WHERE id=1').first<{kill:number}>();
 if(!controls)throw new ServerFailure('E_STORAGE_D1','blocker','Run controls are missing.');
 if(controls.kill)throw new ServerFailure('E_KILL_SWITCH','blocker','The kill switch is set.');
 const run=await store.run(runId);
 if(run.status!=='running')throw new ServerFailure('E_RUN_STOPPED','blocker','This run is not running.');
 if(String(env.MODEL_CALLS_ENABLED)!=='true')throw new ServerFailure('E_MODEL_CALLS_DISABLED','blocker','Model calls are disabled.');
 const unaccounted=await env.DB.prepare("SELECT COUNT(*) AS count FROM vendor_calls WHERE run_id=? AND role!='batch_metadata' AND cost_nano IS NULL").bind(runId).first<{count:number}>();
 const frozen=JSON.parse(run.pack_json??'{}');
 const admission=checkSpendAdmission(frozen.settings?.unknownSpendPolicy,readRunBudget(JSON.parse(run.budget_json)),await store.spendByVendor(runId),unaccounted?.count??0);
 if(admission.reason==='unknown_spend')throw new ServerFailure('E_SPEND_UNACCOUNTED','blocker','New requests are paused because a vendor charge is unknown and the recorded spending policy cannot verify further spending. Completed work is preserved.');
 if(admission.reason==='limit_reached')throw new ServerFailure('E_LIVE_BUDGET','blocker',`Recorded spending reached the run limit: ${admission.reached.join(', ')}. Already submitted calls may still add charges.`);
}
/** Only retrieve/account work already submitted by this run; never authorize new inference. */
export async function accountingGuard(env:Env,store:Store,runId:string,batchId:string):Promise<void>{
 const run=await store.run(runId);
 if(!['running','halted','closing','closed'].includes(run.status))throw new ServerFailure('E_BATCH_ACCOUNTING_SCOPE','blocker','This run has not submitted work eligible for Batch accounting.');
 const owned=await env.DB.prepare('SELECT remote_batch_id FROM batch_jobs WHERE remote_batch_id=? AND run_id=?').bind(batchId,runId).first<{remote_batch_id:string}>();
 if(!owned)throw new ServerFailure('E_BATCH_ACCOUNTING_SCOPE','blocker','Only an already submitted Batch job belonging to this run may be reconciled.');
}
export class Runner {
 readonly env:Env;readonly store:Store;readonly run:RunRow;readonly fingerprint:string;readonly step:WorkflowStep;readonly recoveryId?:string;
 constructor(env:Env,run:RunRow,fingerprint:string,step:WorkflowStep,recoveryId?:string){this.env=env;this.store=new Store(env);this.run=run;this.fingerprint=fingerprint;this.step=step;this.recoveryId=recoveryId;}
 async executionGuard():Promise<void>{
  await assertWorkflowGeneration(this.store,this.run.id,this.recoveryId);
  await guard(this.env,this.store,this.run.id);
 }
 async reference(name:string,action:()=>Promise<string>):Promise<string>{
  await assertWorkflowGeneration(this.store,this.run.id,this.recoveryId);
  return workflowReference(name,{
   execute:callback=>this.step.do(name,{retries:{limit:0,delay:'1 second',backoff:'constant'},timeout:'15 minutes'},callback),
   checkpoint:()=>checkpoint(this.store.checkpoints(this.run.id,this.fingerprint),()=>this.executionGuard(),name,action),
   readCompleted:async()=>{
    const row=await this.env.DB.prepare('SELECT status,artifact_key FROM checkpoints WHERE run_id=? AND fingerprint=? AND name=?').bind(this.run.id,this.fingerprint,name).first<{status:string;artifact_key:string|null}>();
    return row?.status==='complete'?row.artifact_key:null;
   },
   recovered:async source=>{await this.store.event(this.run.id,this.fingerprint,name,'workflow_ack_recovered',{source,policy:'completed-checkpoint-ack-v2'});},
  });
 }
 async accountingStage<T>(name:string,batchId:string,action:()=>Promise<T>):Promise<string>{
  return workflowReference(name,{
   execute:callback=>this.step.do(name,{retries:{limit:0,delay:'1 second',backoff:'constant'},timeout:'15 minutes'},callback),
   checkpoint:()=>checkpoint(this.store.checkpoints(this.run.id,this.fingerprint),()=>accountingGuard(this.env,this.store,this.run.id,batchId),name,async()=>{
    const started=Date.now();await this.store.event(this.run.id,this.fingerprint,name,'accounting_started',{batchId});
    const result=await action();const key=await this.store.put(this.run.id,this.fingerprint,name,result);
    await this.store.event(this.run.id,this.fingerprint,name,'accounting_completed',{key,batchId},Date.now()-started);return key;
   }),
   readCompleted:async()=>{const row=await this.env.DB.prepare('SELECT status,artifact_key FROM checkpoints WHERE run_id=? AND fingerprint=? AND name=?').bind(this.run.id,this.fingerprint,name).first<{status:string;artifact_key:string|null}>();return row?.status==='complete'?row.artifact_key:null;},
   recovered:async source=>{await this.store.event(this.run.id,this.fingerprint,name,'workflow_ack_recovered',{source,policy:'completed-checkpoint-ack-v2',batchId});},
  });
 }
 async stage<T>(name:string,action:()=>Promise<T>,containsText=false):Promise<string>{
  return this.reference(name,async()=>{
   const started=Date.now();await this.store.event(this.run.id,this.fingerprint,name,'started',{});
   const result=await action();const key=await this.store.put(this.run.id,this.fingerprint,name,result,containsText);
   await this.store.event(this.run.id,this.fingerprint,name,'completed',{key},Date.now()-started);return key;
  });
 }
 /** Persist a relative wait once; replays never extend its absolute deadline. */
 async wait(name:string,milliseconds:number):Promise<void>{
  if(!Number.isSafeInteger(milliseconds)||milliseconds<0)throw new ServerFailure('E_WORKFLOW_WAIT_STATE','blocker','The workflow wait duration is invalid.');
  await this.waitDeadline(name,()=>Date.now()+milliseconds);
 }
 async waitUntil(name:string,until:number):Promise<void>{
  if(!Number.isSafeInteger(until)||until<0)throw new ServerFailure('E_WORKFLOW_WAIT_STATE','blocker','The workflow wait deadline is invalid.');
  await this.waitDeadline(name,()=>until);
 }
 async waitAccounting(name:string,milliseconds:number,batchId:string):Promise<void>{
  if(!Number.isSafeInteger(milliseconds)||milliseconds<0)throw new ServerFailure('E_WORKFLOW_WAIT_STATE','blocker','The accounting wait duration is invalid.');
  await this.waitDeadline(name,()=>Date.now()+milliseconds,batchId);
 }
 private async waitDeadline(name:string,createDeadline:()=>number,batchId?:string):Promise<void>{
  // Deadline creation and artifact reads are outside timer-error reconciliation.
  // Any callback/storage failure must propagate rather than look like an elapsed wait.
  const make=async()=>({until:createDeadline(),policy:'absolute-wait-v1'});
  const key=batchId?await this.accountingStage(name+'-deadline',batchId,make):await this.stage(name+'-deadline',make);
  const saved=await this.store.json<{until:number;policy:string}>(key);
  if(saved.policy!=='absolute-wait-v1')throw new ServerFailure('E_WORKFLOW_WAIT_STATE','blocker','The saved workflow wait policy is invalid.');
  await workflowWait(name,saved.until,{
   now:Date.now,guard:()=>batchId?accountingGuard(this.env,this.store,this.run.id,batchId):this.executionGuard(),sleepUntil:(stepName,until)=>this.step.sleepUntil(stepName,until),
   recovered:async until=>{await this.store.event(this.run.id,this.fingerprint,name,'workflow_wait_ack_recovered',{until,policy:'absolute-wait-v1'});},
  });
 }
 async admission(role:VendorRole,nextAttempt:number):Promise<void>{
  await assertWorkflowGeneration(this.store,this.run.id,this.recoveryId);
  // Existing checkpoints represent dispatched/completed/uncertain work and are never sent again.
  const prior=await this.env.DB.prepare('SELECT status FROM checkpoints WHERE run_id=? AND fingerprint=? AND name=?').bind(this.run.id,this.fingerprint,role+'-http-'+nextAttempt).first();
  if(prior)return;
  const scope=providerScope(role);
  await awaitProviderAdmission({now:Date.now,guard:()=>this.executionGuard(),readDeadline:()=>readProviderCooldown(this.env.DB,scope),waitUntil:async until=>{
   const name=role+'-admission-'+nextAttempt+'-'+until;
   await this.stage(name,async()=>{await this.store.event(this.run.id,this.fingerprint,'provider_cooldown','waiting',{scope,until});return{scope,until};});
   // Absolute timestamp and stable name prevent replay from adding another relative delay.
   // This is a top-level Workflow operation, outside both the plan and HTTP step.do callbacks.
   await this.waitUntil(name+'-wait',until);
  }});
 }
 async vendor<T>(request:FrozenVendorRequest,pack:ProjectPack,decode:(raw:unknown)=>T):Promise<string>{
  let index=0,activeId='',sleepIndex=0,fetchFatal:unknown;
  const role=request.role;
  const isolateUnknown=unknownSpendPolicy(pack.settings.unknownSpendPolicy)==='isolate-unlimited-v1'&&readRunBudget(JSON.parse(this.run.budget_json)).mode==='unlimited';
  const deps:TransportDependencies={
   awaitAdmission:()=>this.admission(role,index+1),
   observeRetryAfter:attempt=>observeProviderCooldown(this.env.DB,role,attempt.attemptId,attempt.retryAfter!),
   guard:()=>this.executionGuard(),
   readSecret:async requested=>requested==='confidence'?this.env.JEV_API_KEY.get():this.env.OPENAI_API_KEY.get(),
   now:Date.now,
   attemptId:()=>activeId=`${this.run.id}-${this.fingerprint}-${role}-${++index}`,
   sleep:async milliseconds=>{
    // Sleep is a top-level durable Workflow operation, never nested inside step.do.
    await this.wait(`${role}-retry-wait-${++sleepIndex}`,milliseconds);
   },
   fetch:async(url,init)=>{
    let knownNetworkFailure=false;
    try{
     const key=await this.reference(`${role}-http-${index}`,async()=>{
      const started=Date.now();let response:Response|null=null,raw:string|null=null;let responseKey:string|null=null,rawOverflow=false;
      try{response=await fetch(url,{...init,signal:AbortSignal.timeout(10*60*1000)});}
      catch{response=null;raw=null;/* Record a network failure without persisting a credential-bearing exception. */}
      if(response?.body){
       responseKey=await this.store.putRawStream(this.run.id,this.fingerprint,response.body,`${this.run.id}/${this.fingerprint}/raw-bytes/${activeId}`);
       const stored=await this.env.ARTIFACTS.get(responseKey);
       if(!stored)throw new ServerFailure('E_ARTIFACT_MISSING','blocker','The persisted raw vendor response is missing.');
       rawOverflow=stored.size>8*1024*1024;
       if(!rawOverflow)raw=await stored.text();
      }
      const latencyMs=Date.now()-started;
      const envelope={networkFailure:response===null,status:response?.status??null,headers:response?[...response.headers.entries()]:[],raw,responseKey,rawOverflow,latencyMs};
      const rawKey=await this.store.put(this.run.id,this.fingerprint,'raw_response',envelope,false,`${this.run.id}/${this.fingerprint}/raw/${activeId}.json`);
      // Persistence precedes even the accounting parse. Recording completes in the same guarded step as HTTP.
      let parsed:Record<string,unknown>|null=null;
      try{const value:unknown=raw===null?null:JSON.parse(raw);if(value&&typeof value==='object'&&!Array.isArray(value))parsed=value as Record<string,unknown>;}catch{/* Invalid JSON remains unmodified; the validator handles it. */}
      const hasUsage=parsed!==null&&Object.hasOwn(parsed,'usage');
      const usage=hasUsage?parsed!.usage:null;
      let cost:string|null=null;
      if(response&&(response.status>=200&&response.status<300||hasUsage)){
       try{if(response.status>=200&&response.status<300||parsed&&Object.hasOwn(parsed,'model'))verifyModelPolicy(request.modelPolicy,parsed?.model,role);cost=actualUsageCost(usage,pricingFor(pack,this.run.mode)[role],role==='confidence'?'not_applicable':'disabled');}
       catch(error){await this.store.event(this.run.id,this.fingerprint,role,'accounting_failed',{code:error&&typeof error==='object'&&'code' in error?String(error.code):'E_VENDOR_USAGE'});}
      }
      await this.env.DB.prepare('INSERT INTO vendor_calls(attempt_id,run_id,fingerprint,role,model_requested,model_returned,status,latency_ms,request_id,usage_json,cost_nano,raw_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(activeId,this.run.id,this.fingerprint,role,request.model,typeof parsed?.model==='string'?parsed.model:null,response?.status??null,latencyMs,response?.headers.get('x-request-id')??response?.headers.get('request-id')??null,hasUsage?JSON.stringify(usage):null,cost,rawKey,now()).run();
      await this.store.event(this.run.id,this.fingerprint,role,'vendor_call',{attemptId:activeId,status:response?.status??null},latencyMs);
      return rawKey;
     });
     const envelope=await this.store.json<{networkFailure:boolean;status:number|null;headers:[string,string][];raw:string|null;rawOverflow?:boolean}>(key);
     if(envelope.rawOverflow)throw new ServerFailure('E_VENDOR_RESPONSE_MEMORY','blocker','The complete raw response was saved, but it exceeds the safe validation envelope.');
     if(envelope.networkFailure){knownNetworkFailure=true;throw new Error('Recorded network failure.');}
     return new Response(envelope.raw,{status:envelope.status!,headers:envelope.headers});
    }catch(error){if(!knownNetworkFailure)fetchFatal=error;throw error;}
   },
   persistRaw:async(_attempt:RawAttempt)=>{if(fetchFatal instanceof ServerFailure)throw new ValidationFailure(fetchFatal.code,fetchFatal.kind==='document'?'document':'blocker',fetchFatal.message);if(fetchFatal)throw fetchFatal;},
   ...(isolateUnknown?{unknownCost:async(attemptId:string)=>{const call=await this.env.DB.prepare('SELECT cost_nano FROM vendor_calls WHERE attempt_id=? AND run_id=?').bind(attemptId,this.run.id).first<{cost_nano:string|null}>();if(!call)throw new ServerFailure('E_VENDOR_LOG','blocker','The vendor call was not recorded.');return call.cost_nano===null;}}:{}),
   logCall:async(_call:CallLog)=>{
    const logged=await this.env.DB.prepare('SELECT attempt_id FROM vendor_calls WHERE attempt_id=?').bind(activeId).first();
    if(!logged)throw new ServerFailure('E_VENDOR_LOG','blocker','The vendor call was not recorded.');
   },
   recordDocumentOutcome:async(requested:VendorRole,exhausted:boolean)=>{
    const vendor=requested==='confidence'?'confidence':'reader';
    const key=await this.stage(`${role}-circuit-outcome`,async()=>{
     const result=await this.env.DB.prepare('INSERT INTO vendor_circuits(run_id,vendor,failures) VALUES(?,?,?) ON CONFLICT(run_id,vendor) DO UPDATE SET failures=CASE WHEN ?=1 THEN failures+1 ELSE 0 END RETURNING failures').bind(this.run.id,vendor,exhausted?1:0,exhausted?1:0).first<{failures:number}>();
     if(!result)throw new ServerFailure('E_VENDOR_CIRCUIT_STATE','blocker','The vendor failure counter could not be persisted.');return result;
    });
    return(await this.store.json<{failures:number}>(key)).failures;
   },
  };
  const result=await executeVendor(request,{transportAttempts:3,schemaAttempts:role==='reader'?2:1,baseDelayMs:1000,maxBackoffMs:30000,consecutiveFailureLimit:3},deps,decode);
  return this.stage(`${role}-validated`,async()=>role==='reader'?{...result,evidenceComparisonPolicy:readerEvidencePolicy(pack.settings.readerEvidencePolicy)}:result);
 }
}
