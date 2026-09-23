import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {bundleUi} from './bundle-ui.mjs';
import {readFile,readdir,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Actual managed Worker, workerd, D1 and R2. Access identity below is Miniflare's
// supported local simulation, never evidence of production Cloudflare sign-in.
await mkdir('.local/qa',{recursive:true});
const evidenceDir=await mkdtemp(path.resolve('.local/qa/native-onboarding-'));
const ui=await bundleUi('dist',path.join(evidenceDir,'bundled-ui'));
const compiled=await build({entryPoints:['core/server/managed-worker.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers','cloudflare:workflows'],plugins:[{name:'preserve-text-module',setup(builder){builder.onLoad({filter:/\.txt$/},async args=>({contents:'export default '+JSON.stringify(await readFile(args.path,'utf8'))+';',loader:'js'}));}}],alias:{'project-pack':path.resolve('projects/generic/project.json'),'bundled-ui':ui.modulePath}});
let checks=0,outbound=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
const spoof={'Cf-Access-Jwt-Assertion':'forged.jwt.assertion','Cf-Access-Authenticated-User-Email':'fake@example.invalid','Cookie':'CF_Authorization=forged','Origin':'http://localhost'};
const options={modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-22',d1Databases:['DB'],r2Buckets:['ARTIFACTS'],bindings:{PROJECT_ID:'generic',MODEL_CALLS_ENABLED:'false',BUILD_COMMIT:'local-native-onboarding'},outboundService:request=>{outbound++;throw new Error('Outbound requests forbidden in this local test: '+new URL(request.url).origin);}};
async function runtime(access){
 const mf=new Miniflare(convertV4MiniflareOptions({...options,...(access?{access}:{})}));
 const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('ARTIFACTS');
 for(const name of(await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(path.join('migrations',name),'utf8'));
 return{mf,db,bucket};
}
const endpoints=[['GET','/api/project'],['GET','/api/runs'],['POST','/api/runs'],['POST','/api/quote'],['POST','/api/kill'],['GET','/api/runs/example'],['POST','/api/runs/example/documents'],['POST','/api/runs/example/start'],['POST','/api/runs/example/close'],['GET','/api/runs/example/manifest'],['GET','/api/runs/example/documents/example/evidence'],['POST','/api/runs/example/corrections'],['POST','/api/runs/example/corrections/example/apply']];
let current;
try{
 current=await runtime();
 const {mf,db,bucket}=current;
 for(const headers of [{},spoof]){
  const response=await mf.dispatchFetch('http://localhost/api/health',{headers});check(response.status,200);check(response.headers.get('cache-control'),'no-store');
  const health=await response.json();check(Object.keys(health).sort(),['blockers','modelCallsEnabled','signIn','status']);check(health.status,'NOT READY');check(health.modelCallsEnabled,false);check(health.signIn,{mode:'cloudflare',authenticated:false});check(health.blockers[0].code,'E_ACCESS_SETUP');
  for(const[method,url]of endpoints){const response=await mf.dispatchFetch('http://localhost'+url,{method,headers:{...headers,...(method==='POST'?{'content-type':'application/json'}:{})},...(method==='POST'?{body:'{}'}:{})});check(response.status,401);check((await response.json()).error.code,'E_ACCESS_REQUIRED');}
 }
 check((await db.prepare('SELECT COUNT(*) AS n FROM probes').first()).n,0);check((await db.prepare('SELECT COUNT(*) AS n FROM events').first()).n,0);check((await db.prepare('SELECT COUNT(*) AS n FROM runs').first()).n,0);check((await bucket.list()).objects.length,0);
 let assetCount=0;
 const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8'};
 async function assets(directory,prefix=''){
  for(const item of await readdir(directory,{withFileTypes:true})){
   const disk=path.join(directory,item.name),url=prefix+'/'+item.name;if(item.isDirectory()){await assets(disk,url);continue;}
   const response=await mf.dispatchFetch('http://localhost'+encodeURI(url));check(response.status,200);check(response.headers.get('content-type'),types[path.extname(item.name)]);check(Buffer.from(await response.arrayBuffer()),await readFile(disk));check(response.headers.get('x-content-type-options'),'nosniff');assetCount++;
  }
 }
 await assets('dist');check(assetCount,ui.assets);
 const html=await readFile('dist/index.html');
 for(const route of ['/','/health','/health/','/How%20It%20Works.html']){const response=await mf.dispatchFetch('http://localhost'+route);check(response.status,200);check(Buffer.from(await response.arrayBuffer()),html);}
 for(const route of ['/','/assets/not-present.js','/not-a-screen']){const response=await mf.dispatchFetch('http://localhost'+route,{method:'HEAD'});check(response.status,route==='/'?200:404);check(await response.text(),'');}
 for(const route of ['/assets/not-present.js','/not-a-screen','/%00','/%2fapi%2fruns'])check((await mf.dispatchFetch('http://localhost'+route)).status,404);
 const postAsset=await mf.dispatchFetch('http://localhost/',{method:'POST',body:'{}'});check(postAsset.status,405);check(postAsset.headers.get('allow'),'GET, HEAD');
 await mf.dispose();current=undefined;
 current=await runtime({aud:'local-only-audience',identity:{email:'local@example.invalid',user_uuid:'local-user',account_id:'local-account'}});
 const healthResponse=await current.mf.dispatchFetch('http://localhost/api/health');check(healthResponse.status,200);const health=await healthResponse.json();check(health.signIn,{mode:'cloudflare',authenticated:true});check(health.blockers.some(b=>b.code==='E_ACCESS_CONFIGURATION'||b.code==='E_ACCESS_SETUP'),false);check(health.blockers.some(b=>b.code==='E_STORAGE_D1'||b.code==='E_STORAGE_R2'),false);check(health.blockers.some(b=>b.code==='E_MODEL_CALLS_DISABLED'),true);
 const runs=await current.mf.dispatchFetch('http://localhost/api/runs',{headers:spoof});check(runs.status,200);check(await runs.json(),{runs:[]});
 const crossOrigin=await current.mf.dispatchFetch('http://localhost/api/kill',{method:'POST',headers:{Origin:'https://elsewhere.invalid','content-type':'application/json'},body:'{"enabled":true}'});check(crossOrigin.status,403);check((await crossOrigin.json()).error.code,'E_ORIGIN');check((await current.db.prepare('SELECT kill FROM controls WHERE id=1').first()).kill,0);
 const quote=await current.mf.dispatchFetch('http://localhost/api/quote',{method:'POST',headers:{Origin:'http://localhost','content-type':'application/json'},body:'{}'});check(quote.status,409);check((await quote.json()).error.code,'E_NOT_READY');
 check((await current.db.prepare('SELECT COUNT(*) AS n FROM vendor_calls').first()).n,0);
 await current.mf.dispose();current=undefined;
 for(const identity of [undefined,{email:'local@example.invalid',account_id:'local-account'},{email:'local@example.invalid',user_uuid:'local-user',account_id:'local-account',service_token_status:true}]){
  current=await runtime({aud:'local-only-audience',...(identity?{identity}:{})});
  const status=await(await current.mf.dispatchFetch('http://localhost/api/health')).json();check(status.signIn,{mode:'cloudflare',authenticated:false});check(status.blockers[0].code,'E_ACCESS_INVALID');
  const denied=await current.mf.dispatchFetch('http://localhost/api/runs',{headers:spoof});check(denied.status,401);check((await denied.json()).error.code,'E_ACCESS_INVALID');
  check((await current.db.prepare('SELECT COUNT(*) AS n FROM probes').first()).n,0);check((await current.bucket.list()).objects.length,0);
  await current.mf.dispose();current=undefined;
 }
 check(outbound,0);
 const evidence={at:new Date().toISOString(),checks,assets:assetCount,sensitiveRoutes:endpoints.length,localNativeIdentitySimulation:true,actualManagedEntrypoint:true,remoteMutations:0,vendorCalls:0,outboundRequests:outbound,limitations:['Miniflare Access identity is a supported local simulation, not a real signed-in Cloudflare request.','Generic project remains intentionally unconfigured; vendor and Workflow bindings are not simulated as healthy.']};
 await writeFile(path.join(evidenceDir,'result.json'),JSON.stringify(evidence,null,2));
 console.log(`Native onboarding local runtime: ${checks} checks passed; ${assetCount} built assets, ${endpoints.length} protected routes, zero outbound requests. Native Access is locally simulated, not live verified.`);
}finally{await current?.mf.dispose();}

