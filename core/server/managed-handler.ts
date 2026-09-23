import {nativeActorFor} from './auth.ts';
import {failure,failureResponse} from './errors.ts';
import {uiCopy} from '../ui/copy.ts';
interface ManagedHandlers<E>{assets:(request:Request)=>Response|Promise<Response>;api:(request:Request,env:E,actor:string)=>Promise<Response>}
/** This entry point accepts only the Access context supplied by Cloudflare, never browser configuration. */
export async function handleManagedRequest<E>(request:Request,env:E,access:CloudflareAccessContext|undefined,handlers:ManagedHandlers<E>):Promise<Response>{
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/api/'))return handlers.assets(request);
 let actor:string;
 try{actor=await nativeActorFor(request,access);}catch(error){
  const issue=failure(error);
  if(path==='/api/health'&&request.method==='GET')return Response.json({status:'NOT READY',blockers:[{code:issue.code==='E_ACCESS_REQUIRED'?'E_ACCESS_SETUP':issue.code,headline:uiCopy.signInSetupHeading,action:uiCopy.signInSetupDetail}],signIn:{mode:'cloudflare',authenticated:false},modelCallsEnabled:false},{headers:{'cache-control':'no-store'}});
  return Response.json(failureResponse(issue),{status:issue.status,headers:{'cache-control':'no-store'}});
 }
 return handlers.api(request,env,actor);
}
