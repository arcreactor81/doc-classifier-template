import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { accessIssuer, verifyAccessAssertion } from './auth.ts';
const settings={teamDomain:'unit.cloudflareaccess.com',audience:'unit-audience'};
const keys=await generateKeyPair('RS256');
async function token(options:{issuer?:string;audience?:string;expired?:boolean;subject?:string;omitSubject?:boolean}={}){
 let jwt=new SignJWT({}).setProtectedHeader({alg:'RS256'}).setIssuer(options.issuer??'https://unit.cloudflareaccess.com').setAudience(options.audience??settings.audience).setIssuedAt().setExpirationTime(options.expired?'1 second ago':'5 minutes');
 if(!options.omitSubject)jwt=jwt.setSubject(options.subject??'actor-1');
 return jwt.sign(keys.privateKey);
}
function request(jwt?:string,origin?:string){return new Request('https://unit.invalid/api/runs',{method:'POST',headers:{...(jwt?{'Cf-Access-Jwt-Assertion':jwt}:{}),...(origin?{Origin:origin}:{})}});}
test('Access authenticates a signed assertion and retains its subject as actor',async()=>{
 assert.equal(await verifyAccessAssertion(request(await token(),'https://unit.invalid'),settings,keys.publicKey),'actor-1');
});
test('Access rejects wrong issuer audience signature expiry or missing subject',async()=>{
 for(const options of [{issuer:'https://other.cloudflareaccess.com'},{audience:'other'},{expired:true},{omitSubject:true},{subject:''}]){
  await assert.rejects(verifyAccessAssertion(request(await token(options)),settings,keys.publicKey),{code:'E_ACCESS_INVALID'});
 }
 const other=await generateKeyPair('RS256');
 await assert.rejects(verifyAccessAssertion(request(await token()),settings,other.publicKey),{code:'E_ACCESS_INVALID'});
});
test('Access requires a valid team configuration, audience, assertion and same origin for writes',async()=>{
 assert.throws(()=>accessIssuer('https://untrusted.invalid'),{code:'E_ACCESS_CONFIGURATION'});
 await assert.rejects(verifyAccessAssertion(request(),settings,keys.publicKey),{code:'E_ACCESS_REQUIRED'});
 await assert.rejects(verifyAccessAssertion(request(await token()),{...settings,audience:''},keys.publicKey),{code:'E_ACCESS_CONFIGURATION'});
 await assert.rejects(verifyAccessAssertion(request(await token(),'https://other.invalid'),settings,keys.publicKey),{code:'E_ORIGIN'});
});
