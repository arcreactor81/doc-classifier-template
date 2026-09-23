export interface BundledUiAsset {readonly body:string;readonly contentType:string;readonly immutable:boolean}
export type BundledUiAssets=Readonly<Record<string,BundledUiAsset>>;
const routes=new Set(['/','/index.html','/health','/health/','/How It Works.html']);
/** Serve only build-listed assets and explicit app screens; never hide a missing module behind HTML. */
export function serveBundledAssets(request:Request,assets:BundledUiAssets):Response{
 const head=request.method==='HEAD';
 const headers={'cache-control':'no-store','x-content-type-options':'nosniff'};
 if(request.method!=='GET'&&!head)return new Response(null,{status:405,headers:{...headers,allow:'GET, HEAD'}});
 const raw=new URL(request.url).pathname;let path='';
 try{if(!/%(?:2f|5c|00)/i.test(raw))path=decodeURIComponent(raw);}catch{/* Invalid URL escaping is a missing resource, never an application route. */}
 const key=routes.has(path)?'/index.html':path;
 const asset=Object.hasOwn(assets,key)?assets[key]:undefined;
 if(!asset)return new Response(null,{status:404,headers});
 return new Response(head?null:asset.body,{headers:{...headers,'content-type':asset.contentType,'cache-control':asset.immutable?'public, max-age=31536000, immutable':'no-store'}});
}
