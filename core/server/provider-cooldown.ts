import type {VendorRole} from '../vendors/requests.ts';
import {ValidationFailure} from '../vendors/validate.ts';
import {ServerFailure} from './errors.ts';
// Cloudflare Workflows maximum sleep: 365 days; never silently shorten a provider hint.
export const MAX_PROVIDER_WAIT_MS=365*24*60*60*1000;
export type ProviderScope='openai'|'typesafe';
export const providerScope=(role:VendorRole):ProviderScope=>role==='confidence'?'typesafe':'openai';
/** Relative headers are anchored to the original persisted response time, never replay time. */
export function retryAfterDeadline(header:string,observedAtMs:number):number{
 const value=header.trim();let until:number;
 if(/^\d+(?:\.\d+)?$/.test(value))until=observedAtMs+Math.ceil(Number(value)*1000);
 else if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))throw new ValidationFailure('E_RETRY_AFTER','document','Vendor retry-after numeric delay is invalid.');
 else until=Date.parse(value);
 if(!Number.isSafeInteger(observedAtMs)||observedAtMs<0||!Number.isSafeInteger(until)||until<0||!Number.isFinite(new Date(until).getTime())||until-observedAtMs>MAX_PROVIDER_WAIT_MS)throw new ValidationFailure('E_RETRY_AFTER','document','Vendor retry-after deadline is invalid or unsupported.');
 return Math.max(observedAtMs,until);
}
export async function readProviderCooldown(db:D1Database,scope:ProviderScope):Promise<number>{
 const row=await db.prepare('SELECT until_ms FROM provider_cooldowns WHERE scope=?').bind(scope).first<{until_ms:number}>();
 if(!row)return 0;if(!Number.isSafeInteger(row.until_ms)||row.until_ms<0)throw new ServerFailure('E_COOLDOWN_STATE','blocker','The recorded provider cooldown is invalid.');return row.until_ms;
}
export async function observeProviderCooldown(db:D1Database,role:VendorRole,attemptId:string,header:string):Promise<void>{
 const row=await db.prepare('SELECT role,status,created_at FROM vendor_calls WHERE attempt_id=?').bind(attemptId).first<{role:VendorRole;status:number|null;created_at:string}>();
 if(!row||row.status!==429||row.role!==role)throw new ServerFailure('E_COOLDOWN_SOURCE','blocker','A cooldown requires the recorded throttled attempt.');
 const observed=Date.parse(row.created_at),until=retryAfterDeadline(header,observed),scope=providerScope(role);
 // A stale/equal response cannot replace either the winning deadline or its provenance.
 await db.prepare('INSERT INTO provider_cooldowns(scope,until_ms,source_attempt_id,observed_at_ms) VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET until_ms=excluded.until_ms,source_attempt_id=excluded.source_attempt_id,observed_at_ms=excluded.observed_at_ms WHERE excluded.until_ms>provider_cooldowns.until_ms').bind(scope,until,attemptId,observed).run();
}
export async function awaitProviderAdmission(deps:{now():number;guard():Promise<void>;readDeadline():Promise<number>;waitUntil(until:number):Promise<void>}):Promise<void>{
 for(;;){await deps.guard();const until=await deps.readDeadline();if(until<=deps.now()){await deps.guard();return;}await deps.waitUntil(until);}
}
