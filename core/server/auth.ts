import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ServerFailure } from './errors.ts';
export interface LegacyAccessBindings { ACCESS_TEAM_DOMAIN?:string; ACCESS_AUD?:string }
export function accessIssuer(domain:string|undefined):string {
 if(typeof domain!=='string')throw new ServerFailure('E_ACCESS_CONFIGURATION','blocker','The existing Access team domain is not configured.');
 const host=domain.replace(/^https:\/\//,'').replace(/\/$/,'');
 if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(host))throw new ServerFailure('E_ACCESS_CONFIGURATION','blocker','The existing Access team domain is not configured.');
 return `https://${host}`;
}
export async function verifyAccessAssertion(request:Request,settings:{teamDomain:string;audience:string},keys:CryptoKey|JWTVerifyGetKey):Promise<string>{
 const issuer=accessIssuer(settings.teamDomain);
 if(!settings.audience)throw new ServerFailure('E_ACCESS_CONFIGURATION','blocker','The existing Access application audience is not configured.');
 const token=request.headers.get('Cf-Access-Jwt-Assertion');
 if(!token)throw new ServerFailure('E_ACCESS_REQUIRED','request','Sign in through the configured Access application.',401);
 try{
  const {payload}=await jwtVerify(token,keys,{issuer,audience:settings.audience,algorithms:['RS256'],requiredClaims:['exp','iat','sub']});
  if(typeof payload.sub!=='string'||!payload.sub)throw new Error('Missing actor subject.');
  if(request.method!=='GET'&&request.method!=='HEAD'){
   const origin=request.headers.get('Origin');
   if(origin&&origin!==new URL(request.url).origin)throw new ServerFailure('E_ORIGIN','request','The request must come from this application.',403);
  }
  return payload.sub;
 }catch(error){if(error instanceof ServerFailure)throw error;throw new ServerFailure('E_ACCESS_INVALID','request','Access authentication could not be verified.',401);}
}
export async function actorFor(request:Request,env:Env & LegacyAccessBindings):Promise<string>{
 const issuer=accessIssuer(env.ACCESS_TEAM_DOMAIN);
 const keys=createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
 return verifyAccessAssertion(request,{teamDomain:env.ACCESS_TEAM_DOMAIN!,audience:env.ACCESS_AUD??''},keys);
}

// Only the trusted platform ExecutionContext supplies this value. Never derive it from headers.
export async function nativeActorFor(request:Request,access?:CloudflareAccessContext):Promise<string>{
 if(!access)throw new ServerFailure('E_ACCESS_REQUIRED','request','Enable sign-in for this application, then sign in.',401);
 if(request.method!=='GET'&&request.method!=='HEAD'){
  const origin=request.headers.get('Origin');
  if(origin&&origin!==new URL(request.url).origin)throw new ServerFailure('E_ORIGIN','request','The request must come from this application.',403);
 }
 try{
  if(typeof access.aud!=='string'||!access.aud)throw new Error('Missing platform audience.');
  const identity=await access.getIdentity();
  if(!identity||identity.service_token_status===true||typeof identity.user_uuid!=='string'||!identity.user_uuid.trim()||typeof identity.account_id!=='string'||!identity.account_id.trim()||typeof identity.email!=='string'||!identity.email.trim())throw new Error('A signed-in person is required.');
  return `cloudflare:${encodeURIComponent(identity.account_id)}:${encodeURIComponent(identity.user_uuid)}`;
 }catch{throw new ServerFailure('E_ACCESS_INVALID','request','Sign-in could not be verified. Sign in again and retry.',401);}
}
