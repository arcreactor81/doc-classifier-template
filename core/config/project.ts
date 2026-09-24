import {isFullTextInputPolicy,type ConfidenceStatePolicy} from './input-policy.ts';
import type {DecisionNotePolicy} from '../domain/decision.ts';
import { validateProjectCopy } from '../ui/project-copy.ts';
import type { TokenRates } from '../cost/cost.ts';
export interface DocumentType { id:string; name:string; what:string; not_for:string; examples:string[] }
export interface TypeFile { types:DocumentType[]; none_of_these:{name:string;what:string} }
export interface ModelPin { id:string; date:string; reason:string; policy:'versioned'|'owner_approved_alias' }
export interface ProjectSettings {
 readerEvidencePolicy?:'exact-substring-v1'|'whitespace-quotes-v1';
 decisionNotePolicy:DecisionNotePolicy; confidenceStatePolicy:ConfidenceStatePolicy; digestBudget?:number|null; readerEffort:'low'|'medium'; readerMaxOutputTokens:number; recoveryMaxOutputTokens:number;
 recoveryMinimumHeadings:number; minimumFiledCount:number; batchCutoff:number; defaultMode:'interactive'|'batch';
 pdfPolicy:{largeFontRatio:number;maxHeadingCharacters:number;topPageFraction:number;gapRatio:number};
}
export interface ProjectPack {
 definitionRevisionId?:string; displayNames?:Record<string,string>; definitionThreshold?:number; definitionThresholdJustification?:string; definitionThresholdStatus?:'untested'|'unverified'|'calibrated';
 prices:{verifiedAt:string;source:string[];interactive:{confidence:TokenRates;reader:TokenRates;recovery:TokenRates};batch:{confidence:TokenRates;reader:TokenRates;recovery:TokenRates}};
 schemaVersion:1; id:string; productName:string; copyOverrides?:Record<string,string>; typeFile:TypeFile; structuralVocabulary:string[];
 settings:ProjectSettings; pins:{confidence:ModelPin;reader:ModelPin;recovery:ModelPin};
 /** Historical project sign-off only; every new run supplies its own budget choice. */
 budget?:{limitNano:string|null;approvedBy:string|null;approvedAt:string|null;reason:string|null}|null;
 /** Retired local-counter metadata; not used by the current state policy. */
 tokenizers?:{confidence?:{id:string;verifiedAt:string;source:string}|null;reader?:{id:string;verifiedAt:string;source:string}|null}|null;
 limits:{readerRequestsPerMinute:number|null;readerTokensPerMinute:number|null;readerContextTokens:number;readerBatchEnqueuedTokens:number|null;confidenceRequestsPerMinute:number|null;confidenceStateQuestionTokens:number;confidenceAllQuestionTokens:number};
}
export interface ConfigIssue {code:string;path:string;detail:string}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const nonempty=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const reserved=new Set(['none_of_these','human_review','could_not_process','con','prn','aux','nul','com1','com2','com3','com4','com5','com6','com7','com8','com9','lpt1','lpt2','lpt3','lpt4','lpt5','lpt6','lpt7','lpt8','lpt9','constructor','prototype','__proto__']);
export const words=(text:string):string[]=>text.normalize('NFKC').toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu)??[];
export function validateTypes(value:unknown):ConfigIssue[]{
 const issues:ConfigIssue[]=[]; const issue=(path:string,detail:string)=>issues.push({code:'E_TYPE_FILE',path:'typeFile.'+path,detail});
 if(!record(value)){issue('','Type file is missing.');return issues;}
 if(!Array.isArray(value.types)||value.types.length<1||value.types.length>254){issue('types','Define between 1 and 254 types.');return issues;}
 const ids=new Set<string>(),names=new Set<string>();
 for(const [i,item] of value.types.entries()){
  if(!record(item)){issue('types.'+i,'Type must be an object.');continue;}
  for(const field of ['id','name','what','not_for']) if(!nonempty(item[field])) issue('types.'+i+'.'+field,'A nonempty value is required.');
  if(typeof item.id==='string'){
   if(!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(item.id)||reserved.has(item.id)||ids.has(item.id)) issue('types.'+i+'.id','Identifier must be unique, safe and snake_case.');
   ids.add(item.id);
  }
  if(typeof item.name==='string'){const key=item.name.toLocaleLowerCase('en');if(names.has(key)) issue('types.'+i+'.name','Type names must be distinct.');names.add(key);}
  if(!Array.isArray(item.examples)||item.examples.length===0||!item.examples.every(nonempty))issue('types.'+i+'.examples','At least one nonempty example is required.');
 }
 if(!record(value.none_of_these)||!nonempty(value.none_of_these.name)||!nonempty(value.none_of_these.what))issue('none_of_these','Define the none-of-these option.');
 return issues;
}
export function validateProject(value:unknown):ConfigIssue[]{
 const issues:ConfigIssue[]=[]; const issue=(path:string,detail:string,code='E_PROJECT_CONFIG')=>issues.push({code,path,detail});
 if(!record(value)){issue('','Project pack must be an object.');return issues;}
 issues.push(...validateTypes(value.typeFile));
 if(value.schemaVersion!==1)issue('schemaVersion','Expected schema version 1.');
 if(!nonempty(value.id)||!/^[a-z][a-z0-9_-]*$/.test(value.id))issue('id','Project identifier is required.');
 for(const copyIssue of validateProjectCopy(value))issue(copyIssue.path,copyIssue.detail,'E_PROJECT_COPY');
 if(!Array.isArray(value.structuralVocabulary)||!value.structuralVocabulary.every(nonempty))issue('structuralVocabulary','An explicit array of structural terms is required.');
 else if(record(value.typeFile)&&Array.isArray(value.typeFile.types)){
  for(const term of value.structuralVocabulary as string[]){
   const termWords=words(term);
   for(const type of value.typeFile.types){
    if(!record(type))continue;
    const fields=[type.name,type.what,...(Array.isArray(type.examples)?type.examples:[])].filter((s):s is string=>typeof s==='string');
    if(fields.some(field=>{const tokens=words(field);return termWords.some(word=>tokens.includes(word));}))
     issue('structuralVocabulary','Structural term collides with type vocabulary: '+term,'E_VOCABULARY_COLLISION');
   }
  }
 }
 const settings=value.settings;
 if(record(settings)&&settings.readerEvidencePolicy!==undefined&&!['exact-substring-v1','whitespace-quotes-v1'].includes(String(settings.readerEvidencePolicy)))issue('settings.readerEvidencePolicy','Unknown reader evidence policy.');
 if(!record(settings))issue('settings','Explicit settings are required.');
 else{
  for(const field of ['readerMaxOutputTokens','recoveryMaxOutputTokens','recoveryMinimumHeadings','minimumFiledCount','batchCutoff'])
   if(!Number.isSafeInteger(settings[field])||Number(settings[field])<1)issue('settings.'+field,'A positive integer is required.');
  if(!['all-notes-review-v1','full-state-structural-info-v2'].includes(String(settings.decisionNotePolicy))||settings.decisionNotePolicy==='full-state-structural-info-v2'&&!isFullTextInputPolicy(settings.confidenceStatePolicy))issue('settings.decisionNotePolicy','Select an explicit compatible decision note policy.');
  if(!isFullTextInputPolicy(settings.confidenceStatePolicy))issue('settings.confidenceStatePolicy','Select an explicit supported full-text input policy.');
  if(!['low','medium'].includes(String(settings.readerEffort)))issue('settings.readerEffort','Select low or medium.');
  if(!['interactive','batch'].includes(String(settings.defaultMode)))issue('settings.defaultMode','Select interactive or batch.');
  if(!record(settings.pdfPolicy))issue('settings.pdfPolicy','Explicit extraction policy is required.');
 }
 if(!record(value.pins))issue('pins','Model configuration is required.');
 else for(const role of ['confidence','reader','recovery']){
  const pin=value.pins[role];
  if(!record(pin)||!nonempty(pin.id)||!nonempty(pin.date)||!nonempty(pin.reason)){issue('pins.'+role,'Record model ID, date and reason.');continue;}
  const aliases=role==='reader'?['gpt-5.6-terra','gpt-6-sol']:role==='recovery'?['gpt-5.6-luna','gpt-6-luna']:[];
  const versioned=role==='confidence'?/^jev-\d+\.\d+\.\d+$/.test(pin.id):role==='reader'?/^gpt-(?:5\.6-terra|6-sol)-\d{4}-\d{2}-\d{2}$/.test(pin.id):/^gpt-(?:5\.6-luna|6-luna)-\d{4}-\d{2}-\d{2}$/.test(pin.id);
  if(!(pin.policy==='versioned'&&versioned)&&!(pin.policy==='owner_approved_alias'&&aliases.includes(pin.id)))
   issue('pins.'+role,'Only versioned models or explicitly approved aliases for this role are permitted.','E_MODEL_POLICY');
 }
 const integerMoney=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v);
 const positiveRatio=(v:unknown)=>record(v)&&integerMoney(v.numerator)&&integerMoney(v.denominator)&&BigInt(v.numerator)>0n&&BigInt(v.denominator)>0n;
 const prices=value.prices;
 if(!record(prices)||!nonempty(prices.verifiedAt)||!Array.isArray(prices.source)||prices.source.length===0||!prices.source.every(nonempty))issue('prices','Verified pricing date and source documentation are required.','E_PRICING_UNVERIFIED');
 if(record(prices))for(const mode of ['interactive','batch']){
  const rates=prices[mode];
  if(!record(rates)){issue('prices.'+mode,'Rates for every execution mode are required.','E_PRICING_UNVERIFIED');continue;}
  for(const role of ['confidence','reader','recovery']){
   const rate=rates[role],path='prices.'+mode+'.'+role;
   if(!record(rate)||!integerMoney(rate.inputNanodollarsPerMillion)||!integerMoney(rate.outputNanodollarsPerMillion)){issue(path,'Nonnegative integer nanodollar rates are required.','E_PRICING_UNVERIFIED');continue;}
   if(rate.longContext!==undefined){
    const tier=rate.longContext;
    if(!record(tier)||!Number.isSafeInteger(tier.aboveInputTokens)||Number(tier.aboveInputTokens)<0||!positiveRatio(tier.inputMultiplier)||!positiveRatio(tier.outputMultiplier))issue(path+'.longContext','A valid token boundary and positive rate multipliers are required.','E_PRICING_UNVERIFIED');
   }
  }
 }
 if(!record(value.limits))issue('limits','Explicit model limits and throughput knowledge are required.');
 else {
  for(const field of ['readerContextTokens','confidenceStateQuestionTokens','confidenceAllQuestionTokens'])
   if(!Number.isSafeInteger(value.limits[field])||Number(value.limits[field])<1)issue('limits.'+field,'A verified positive integer limit is required.');
  for(const field of ['readerRequestsPerMinute','readerTokensPerMinute','readerBatchEnqueuedTokens','confidenceRequestsPerMinute'])
   if(value.limits[field]!==null&&(!Number.isSafeInteger(value.limits[field])||Number(value.limits[field])<1))issue('limits.'+field,'Provide a positive integer or explicit null when throughput is unknown.');
 }
 return issues;
}
export function requireProject(value:unknown):ProjectPack{
 const issues=validateProject(value);
 if(issues.length)throw Object.assign(new Error('Project configuration is not ready.'),{code:'E_PROJECT_CONFIG',kind:'blocker',issues});
 return value as ProjectPack;
}
export async function typeVersion(exactSource:string):Promise<string>{
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(exactSource));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}

/** Unknown throughput is distinct from a zero-call run and never becomes a guessed rate. */
export function projectInteractiveSeconds(documentCount:number,readerTokens:number,limits:ProjectPack['limits']):number|null{
 if(documentCount===0)return 0;
 const {confidenceRequestsPerMinute,readerRequestsPerMinute,readerTokensPerMinute}=limits;
 if(confidenceRequestsPerMinute===null||readerRequestsPerMinute===null||readerTokensPerMinute===null)return null;
 return Math.ceil(Math.max(documentCount/confidenceRequestsPerMinute,documentCount/readerRequestsPerMinute,readerTokens/readerTokensPerMinute)*60);
}

/** Absence in already-frozen historical run packs means the previously implemented all-notes rule. Never use for new project/quote validation. */
export function runDecisionNotePolicy(settings:unknown):DecisionNotePolicy{
 if(!record(settings))throw new Error('Frozen run settings are missing.');
 if(!Object.hasOwn(settings,'decisionNotePolicy'))return'all-notes-review-v1';
 if(settings.decisionNotePolicy!=='all-notes-review-v1'&&settings.decisionNotePolicy!=='full-state-structural-info-v2')throw new Error('Frozen run note policy is invalid.');
 if(settings.decisionNotePolicy==='full-state-structural-info-v2'&&!isFullTextInputPolicy(settings.confidenceStatePolicy))throw new Error('Frozen run note policy requires full structured state.');
 return settings.decisionNotePolicy;
}
export function requireRunProject(value:unknown):ProjectPack{
 if(!record(value)||!record(value.settings))return requireProject(value);
 const decisionNotePolicy=runDecisionNotePolicy(value.settings);
 return requireProject({...value,settings:{...value.settings,decisionNotePolicy}});
}
