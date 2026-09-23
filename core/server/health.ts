import { readVendorHealth,type VendorHealth } from './vendor-health.ts';
import rawProject from 'project-pack' with {type:'json'};
import { validateProject, typeVersion, type ProjectPack } from '../config/project.ts';
import { pricingFor } from './capabilities.ts';
import { accessIssuer, type LegacyAccessBindings } from './auth.ts';
import { ServerFailure,serverCopy } from './errors.ts';
import { Store,now } from './store.ts';
export const projectSource=rawProject;
export async function health(env:Env & LegacyAccessBindings,authentication:'legacy'|'cloudflare'='legacy'):Promise<Record<string,unknown>>{
 const blockers:{code:string;headline:string;action:string;details?:unknown}[]=[];
 const add=(code:string,headline:string,details?:unknown)=>blockers.push({code,headline,action:serverCopy.action,...(details?{details}:{})});
 for(const issue of validateProject(rawProject))add(issue.code,issue.detail,{path:issue.path});
 const pack=(rawProject&&typeof rawProject==='object'?rawProject:{}) as Partial<ProjectPack>;
 if(pack.id!==String(env.PROJECT_ID))add('E_PROJECT_BINDING','The deployed project identity differs from its selected Git pack.');
 for(const mode of ['interactive','batch'] as const){try{pricingFor(pack as ProjectPack,mode);}catch(error){add('E_PRICING_UNVERIFIED','Published prices must be recorded before a run can start.',{mode});}}
 if(String(env.MODEL_CALLS_ENABLED)!=='true')add('E_MODEL_CALLS_DISABLED','Model calls are disabled by the deployment.');
 if(authentication==='legacy')try{accessIssuer(env.ACCESS_TEAM_DOMAIN);if(!env.ACCESS_AUD)throw new Error('Missing audience.');}catch{add('E_ACCESS_CONFIGURATION','Connect the existing Access application identity settings.');}
 let threshold:unknown=null,textHeldRuns=0;let vendorHistory:VendorHealth={status:'unavailable',latest:null,unknownSpendCount:null};
 try{
  if(!env.DB)throw new Error('DB binding is absent.');
  const probe=`deployment-${env.BUILD_COMMIT}`;
  await env.DB.prepare('INSERT OR IGNORE INTO probes(id,created_at) VALUES(?,?)').bind(probe,now()).run();
  await env.DB.prepare('SELECT scope FROM provider_cooldowns LIMIT 1').first();
  const control=await env.DB.prepare('SELECT * FROM controls WHERE id=1').first<{kill:number;threshold:number;threshold_justification:string}>();
  if(!control)throw new Error('Controls were not initialized.');
  if(control.kill)add('E_KILL_SWITCH','The kill switch is set.');
  threshold={value:control.threshold,justification:control.threshold_justification};
  vendorHistory=await readVendorHealth(env.DB);
  textHeldRuns=(await env.DB.prepare('SELECT COUNT(*) AS count FROM runs WHERE text_held=1').first<{count:number}>())?.count??0;
 }catch(error){add('E_STORAGE_D1','The database write probe failed.',{detail:error instanceof Error?error.message:String(error)});}
 try{
  if(!env.ARTIFACTS)throw new Error('ARTIFACTS binding is absent.');
  const key=`system/probes/${env.BUILD_COMMIT}.json`;
  if(!await env.ARTIFACTS.head(key)){
   const written=await env.ARTIFACTS.put(key,JSON.stringify({createdAt:now()}),{onlyIf:new Headers({'If-None-Match':'*'})});
   if(!written&&!await env.ARTIFACTS.head(key))throw new Error('The immutable write did not complete.');
  }
 }catch(error){add('E_STORAGE_R2','The artifact storage probe failed.',{detail:error instanceof Error?error.message:String(error)});}
 if(!env.DOCUMENT_WORKFLOW)add('E_WORKFLOW_BINDING','The document workflow binding is missing.');
 for(const [name,binding] of [['reader',env.OPENAI_API_KEY],['confidence',env.JEV_API_KEY]] as const){
  try{if(!binding||!await binding.get())add('E_VENDOR_KEY','A vendor credential is missing.',{role:name});}catch{add('E_VENDOR_KEY','A vendor credential could not be read.',{role:name});}
 }
 return{status:blockers.length?'NOT READY':'READY',blockers,versions:{build:env.BUILD_COMMIT,pins:pack.pins??null},project:{id:typeof pack.id==='string'?pack.id:null,productName:typeof pack.productName==='string'?pack.productName:null,typeVersion:pack.typeFile?await typeVersion(JSON.stringify(pack.typeFile)):null,types:Array.isArray(pack.typeFile?.types)?pack.typeFile.types:null,copyOverrides:pack.copyOverrides},modelCallsEnabled:String(env.MODEL_CALLS_ENABLED)==='true',textHeldRuns,threshold,vendorStatus:vendorHistory.status,vendorHistory};
}
export async function requireReady(env:Env & LegacyAccessBindings,authentication:'legacy'|'cloudflare'='legacy'):Promise<void>{const status=await health(env,authentication);if(status.status!=='READY')throw new ServerFailure('E_NOT_READY','blocker',serverCopy.notReady);}