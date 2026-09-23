import test from 'node:test';
import assert from 'node:assert/strict';
import {serveBundledAssets,type BundledUiAssets} from './bundled-assets.ts';
const assets:BundledUiAssets={
 '/index.html':{body:'<main>App</main>',contentType:'text/html; charset=utf-8',immutable:false},
 '/assets/app-abcdefgh.js':{body:'/* unchanged */ export const a=1;',contentType:'text/javascript; charset=utf-8',immutable:true},
};
test('bundled UI serves known SPA routes and exact assets with MIME and cache controls',async()=>{
 for(const path of ['/','/index.html','/health','/health/','/How%20It%20Works.html']){const response=serveBundledAssets(new Request('https://unit.invalid'+path),assets);assert.equal(response.status,200);assert.equal(await response.text(),assets['/index.html'].body);assert.equal(response.headers.get('cache-control'),'no-store');}
 const response=serveBundledAssets(new Request('https://unit.invalid/assets/app-abcdefgh.js?v=1'),assets);assert.equal(await response.text(),assets['/assets/app-abcdefgh.js'].body);assert.equal(response.headers.get('content-type'),'text/javascript; charset=utf-8');assert.equal(response.headers.get('cache-control'),'public, max-age=31536000, immutable');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
});
test('bundled UI never turns missing assets or unknown routes into index HTML',async()=>{
 for(const path of ['/assets/missing.js','/unknown','/api/runs','/worker-assets.mjs','/%ZZ','/assets%2fapp-abcdefgh.js','/assets/%2e%2e%2findex.html']){const response=serveBundledAssets(new Request('https://unit.invalid'+path),assets);assert.equal(response.status,404,path);assert.doesNotMatch(await response.text(),/<main>/);}
});
test('bundled UI HEAD is bodyless and unsafe methods receive 405',async()=>{
 const head=serveBundledAssets(new Request('https://unit.invalid/',{method:'HEAD'}),assets);assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('content-type'),'text/html; charset=utf-8');
 const absent=serveBundledAssets(new Request('https://unit.invalid/missing',{method:'HEAD'}),assets);assert.equal(absent.status,404);assert.equal(await absent.text(),'');
 for(const method of ['POST','PUT','DELETE']){const response=serveBundledAssets(new Request('https://unit.invalid/',{method}),assets);assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET, HEAD');}
});
