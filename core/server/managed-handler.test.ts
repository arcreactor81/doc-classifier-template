import test from 'node:test';
import assert from 'node:assert/strict';
import {handleManagedRequest} from './managed-handler.ts';
const identity={aud:'application',getIdentity:async()=>({user_uuid:'person',account_id:'account',email:'person@example.invalid'})};
test('fresh setup reveals no project, history or storage metadata before verified sign-in',async()=>{
 let calls=0;const handlers={assets:()=>new Response('app'),api:async()=>{calls++;return Response.json({});}};
 const response=await handleManagedRequest(new Request('https://unit.invalid/api/health'),{},undefined,handlers);
 assert.equal(response.status,200);const body=await response.json() as {signIn:{authenticated:boolean};status:string;modelCallsEnabled:boolean};
 assert.equal(body.signIn.authenticated,false);assert.equal(body.status,'NOT READY');assert.equal(body.modelCallsEnabled,false);
 for(const field of ['project','threshold','vendorHistory','versions','textHeldRuns'])assert.equal(field in body,false);
 assert.equal(calls,0);
});
test('all protected APIs remain locked even with spoofed identity headers',async()=>{
 let calls=0;const handlers={assets:()=>new Response('app'),api:async()=>{calls++;return Response.json({});}};
 for(const [path,method] of [['/api/project','GET'],['/api/runs','GET'],['/api/runs','POST'],['/api/quote','POST'],['/api/kill','POST'],['/api/runs/id/corrections','POST'],['/api/health','POST']]){
  const response=await handleManagedRequest(new Request('https://unit.invalid'+path,{method,headers:{'Cf-Access-Jwt-Assertion':'forged','Cf-Access-Authenticated-User-Email':'person@example.invalid'}}),{},undefined,handlers);
  assert.equal(response.status,401);assert.equal((await response.json() as {error:{code:string}}).error.code,'E_ACCESS_REQUIRED');
 }
 assert.equal(calls,0);
});
test('verified identity is passed per request while static UI remains available for setup',async()=>{
 const actors:string[]=[];const handlers={assets:()=>new Response('app'),api:async(_r:Request,_e:object,actor:string)=>{actors.push(actor);return Response.json({ok:true});}};
 assert.equal(await(await handleManagedRequest(new Request('https://unit.invalid/'),{},undefined,handlers)).text(),'app');
 const response=await handleManagedRequest(new Request('https://unit.invalid/api/runs'),{},identity,handlers);
 assert.equal(response.status,200);assert.deepEqual(actors,['cloudflare:account:person']);
 const denied=await handleManagedRequest(new Request('https://unit.invalid/api/runs',{method:'POST',headers:{Origin:'https://other.invalid'}}),{},identity,handlers);
 assert.equal(denied.status,403);assert.equal(actors.length,1);
});
