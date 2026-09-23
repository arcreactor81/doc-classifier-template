import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {extname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8'};
/** Generate Worker Text imports separately from dist, leaving legacy ASSETS deployments unchanged. */
export async function bundleUi(sourceDirectory='dist',outputDirectory='.wrangler/bundled-ui'){
 const source=resolve(sourceDirectory),output=resolve(outputDirectory),within=relative(source,output);
 if(within===''||!isAbsolute(within)&&within!=='..'&&!within.startsWith('..'+sep))throw new Error('Bundled UI output must be outside the public asset directory.');
 const files=[];
 async function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){
  const full=join(directory,entry.name);if(entry.isSymbolicLink())throw new Error('UI assets must not contain a symbolic link.');
  if(entry.isDirectory()){await walk(full);continue;}if(!entry.isFile())throw new Error('UI assets must be regular files.');
  const name=relative(source,full).split(sep).join('/');
  if(name.split('/').some(part=>!part||part==='.'||part==='..'||/[\\%?#\u0000-\u001f\u007f]/.test(part)))throw new Error('Invalid UI asset path.');
  const contentType=mime[extname(name).toLowerCase()];if(!contentType)throw new Error('Unsupported UI asset type: '+name+'. Add an explicit module type before deploying.');
  const bytes=await readFile(full);let body;try{body=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw new Error('UI asset is not valid UTF-8: '+name);}
  files.push({path:'/'+name,contentType,body,immutable:name.startsWith('assets/')&&/-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(name)});
 }}
 await walk(source);files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(!files.some(file=>file.path==='/index.html'))throw new Error('Built UI index.html is missing. Run the Vite build first.');
 const modules=join(output,'worker-ui');await mkdir(modules,{recursive:true});
 const imports=[],entries=[];
 for(const [index,file]of files.entries()){
  const name=String(index).padStart(5,'0')+'.txt';await writeFile(join(modules,name),file.body,'utf8');
  imports.push(`import asset${index} from ${JSON.stringify('./worker-ui/'+name)};`);
  entries.push(`${JSON.stringify(file.path)}:{body:asset${index},contentType:${JSON.stringify(file.contentType)},immutable:${file.immutable}}`);
 }
 const modulePath=join(output,'worker-assets.mjs');await writeFile(modulePath,imports.join('\n')+'\nexport default Object.freeze({\n'+entries.join(',\n')+'\n});\n','utf8');
 return{modulePath,assets:files.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const result=await bundleUi();console.log(`Bundled UI: ${result.assets} assets.`);}
