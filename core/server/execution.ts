import type { WorkflowStep } from 'cloudflare:workers';
import type { ProjectPack } from '../config/project.ts';
import { actualUsageCost } from '../cost/cost.ts';
import { checkRunBudget,readRunBudget } from '../cost/run-budget.ts';
import { executeVendor, type CallLog, type RawAttempt, type TransportDependencies } from '../vendors/transport.ts';
import { verifyModelPolicy,type FrozenVendorRequest,type VendorRole } from '../vendors/requests.ts';
import { Store,now,type RunRow } from './store.ts';
import { checkpoint } from './checkpoint.ts';
import { pricingFor } from './capabilities.ts';
import { ServerFailure } from './errors.ts';
export async function guard(env:Env,store:Store,runId:string):Promise<void>{
 const controls=await env.DB.prepare('SELECT kill FROM controls WHERE id=1').first<{kill:number}>();
 if(!controls)throw new ServerFailure('E_STORAGE_D1','blocker','Run controls are missing.');
 if(controls.kill)throw new ServerFailure('E_KILL_SWITCH','blocker','The kill switch is set.');
 const run=await store.run(runId);
 if(run.status!=='running')throw new ServerFailure('E_RUN_STOPPED','blocker','This run is not running.');
 if(String(env.MODEL_CALLS_ENABLED)!=='true')throw new ServerFailure('E_MODEL_CALLS_DISABLED','blocker','Model calls are disabled.');
 const unaccounted=await env.DB.prepare("SELECT COUNT(*) AS count FROM vendor_calls WHERE run_id=? AND role!='batch_metadata' AND (status BETWEEN 200 AND 299 OR usage_json IS NOT NULL) AND cost_nano IS NULL").bind(runId).first<{count:number}>();
 if(unaccounted?.count)throw new ServerFailure('E_SPEND_UNACCOUNTED','blocker','A vendor response has unaccounted spending. The run has halted for review.');
 const budget=checkRunBudget(readRunBudget(JSON.parse(run.budget_json)),await store.spendByVendor(runId));
 if(budget.halt)throw new ServerFailure('E_LIVE_BUDGET','blocker',`Recorded spending reached the run limit: ${budget.reached.join(', ')}. Already submitted calls may still add charges.`);
}
/** Only retrieve/account work already submitted by this run; never authorize new inference. */
export async function accountingGuard(env:Env,store:Store,runId:string,batchId:string):Promise<void>{
 const run=await store.run(runId);
 if(!['running','halted','closing','closed'].includes(run.status))throw new ServerFailure('E_BATCH_ACCOUNTING_SCOPE','blocker','This run has not submitted work eligible for Batch accounting.');
 const owned=await env.DB.prepare('SELECT remote_batch_id FROM batch_jobs WHERE remote_batch_id=? AND run_id=?').bind(batchId,runId).first<{remote_batch_id:string}>();
 if(!owned)throw new ServerFailure('E_BATCH_ACCOUNTING_SCOPE','blocker','Only an already submitted Batch job belonging to this run may be reconciled.');
}
export class Runner {
 readonly env:Env;readonly store:Store;readonly run:RunRow;readonly fingerprint:string;readonly step:WorkflowStep;
 constructor(env:Env,run:RunRow,fingerprint:string,step:WorkflowStep){this.env=env;this.store=new Store(env);this.run=run;this.fingerprint=fingerprint;this.step=step;}
 async reference(name:string,action:()=>Promise<string>):Promise<string>{
  return this.step.do(name,{retries:{limit:0,delay:'1 second',backoff:'constant'},timeout:'15 minutes'},async()=>checkpoint(this.store.checkpoints(this.run.id,this.fingerprint),()=>guard(this.env,this.store,this.run.id),name,action));
 }
 async accountingStage<T>(name:string,batchId:string,action:()=>Promise<T>):Promise<string>{
  return this.step.do(name,{retries:{limit:0,delay:'1 second',backoff:'constant'},timeout:'15 minutes'},async()=>checkpoint(this.store.checkpoints(this.run.id,this.fingerprint),()=>accountingGuard(this.env,this.store,this.run.id,batchId),name,async()=>{
   const started=Date.now();await this.store.event(this.run.id,this.fingerprint,name,'accounting_started',{batchId});
   const result=await action();const key=await this.store.put(this.run.id,this.fingerprint,name,result);
   await this.store.event(this.run.id,this.fingerprint,name,'accounting_completed',{key,batchId},Date.now()-started);return key;
  }));
 }
 async stage<T>(name:string,action:()=>Promise<T>,containsText=false):Promise<string>{
  return this.reference(name,async()=>{
   const started=Date.now();await this.store.event(this.run.id,this.fingerprint,name,'started',{});
   const result=await action();const key=await this.store.put(this.run.id,this.fingerprint,name,result,containsText);
   await this.store.event(this.run.id,this.fingerprint,name,'completed',{key},Date.now()-started);return key;
  });
 }
 async vendor<T>(request:FrozenVendorRequest,pack:ProjectPack,decode:(raw:unknown)=>T):Promise<string>{
  let index=0,activeId='',sleepIndex=0,fetchFatal:unknown;
  const role=request.role;
  const deps:TransportDependencies={
   guard:()=>guard(this.env,this.store,this.run.id),
   readSecret:async requested=>requested==='confidence'?this.env.JEV_API_KEY.get():this.env.OPENAI_API_KEY.get(),
   now:Date.now,
   attemptId:()=>activeId=`${this.run.id}-${this.fingerprint}-${role}-${++index}`,
   sleep:async milliseconds=>{
    // Sleep is a top-level durable Workflow operation, never nested inside step.do.
    await this.step.sleep(`${role}-retry-wait-${++sleepIndex}`,milliseconds);
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
   persistRaw:async(_attempt:RawAttempt)=>{if(fetchFatal)throw fetchFatal;},
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
  return this.stage(`${role}-validated`,async()=>result);
 }
}