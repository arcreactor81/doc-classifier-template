import type {Store,RunRow} from './store.ts';
import {ServerFailure,failureResponse,serverCopy} from './errors.ts';
interface HaltEvent{created_at:string;details_json:string}
interface UnknownCall{role:string;status:number|null;raw_key:string;fingerprint:string;attempt_id:string;original_filename:string}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Read-only explanation: older releases overwrote halt_json, but retained the first halt event. */
export async function readRunStopReason(store:Store,run:RunRow){
 if(run.status!=='halted')return null;
 const first=await store.env.DB.prepare("SELECT created_at,details_json FROM events WHERE run_id=? AND stage='run' AND kind='halted' ORDER BY created_at,rowid LIMIT 1").bind(run.id).first<HaltEvent>();
 const raw:unknown=JSON.parse(first?.details_json??run.halt_json??'{}');
 const code=record(raw)&&typeof raw.code==='string'?raw.code:'E_RUN_HALTED';
 const message=record(raw)&&typeof raw.message==='string'?raw.message:code==='E_KILL_SWITCH'?serverCopy.runKilled:serverCopy.runHalted;
 const error=failureResponse(new ServerFailure(code,'blocker',message)).error;
 const details:Record<string,unknown>={...error.details,...(first?{firstObservedAt:first.created_at}: {})};
 let headline=error.headline;
 if(code==='E_SPEND_UNACCOUNTED'){
  const call=await store.env.DB.prepare("SELECT v.role,v.status,v.raw_key,v.fingerprint,v.attempt_id,d.original_filename FROM vendor_calls v LEFT JOIN documents d ON d.run_id=v.run_id AND d.fingerprint=v.fingerprint WHERE v.run_id=? AND v.role!='batch_metadata' AND v.cost_nano IS NULL ORDER BY v.created_at,v.attempt_id LIMIT 1").bind(run.id).first<UnknownCall>();
  if(call){Object.assign(details,{role:call.role,httpStatus:call.status,attemptId:call.attempt_id,document:call.original_filename,costKnown:false});
   if(call.role==='confidence'&&call.status===400){
    if(!call.raw_key.startsWith(run.id+'/'+call.fingerprint+'/raw/'))throw new ServerFailure('E_ARTIFACT_SCOPE','blocker','The recorded response does not belong to this document.');
    const envelope=await store.json<{raw:string|null}>(call.raw_key);let body:unknown=null;
    try{body=envelope.raw===null?null:JSON.parse(envelope.raw);}catch{/* Retain generic missing-usage cause; malformed provider data supplies no trusted specific diagnosis. */}
    if(record(body)&&body.error_type==='max_tokens_exceeded'){headline=serverCopy.runSizeUnknownUsage;details.providerErrorType='max_tokens_exceeded';}
   }
  }
 }
 return{...error,headline,action:serverCopy.runHaltAction,details};
}
