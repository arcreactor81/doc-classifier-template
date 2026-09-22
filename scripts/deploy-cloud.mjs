import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import ts from 'typescript';
function parse(text){const result=ts.parseConfigFileTextToJson('wrangler.jsonc',text);if(result.error)throw new Error('Invalid Wrangler JSON configuration.');return result.config;}
function masked(config){
 const value=structuredClone(config);delete value.name;
 for(const binding of value.d1_databases??[]){delete binding.database_id;delete binding.database_name;}
 for(const binding of value.r2_buckets??[])delete binding.bucket_name;
 for(const binding of value.secrets_store_secrets??[]){delete binding.store_id;delete binding.secret_name;}
 for(const binding of value.workflows??[])delete binding.name;
 return value;
}
export function validateProvisioningMutation(committed,current){
 if(!isDeepStrictEqual(masked(committed),masked(current)))throw new Error('Unexpected uncommitted configuration change; commit settings before deployment. Only provisioned resource names and IDs may differ.');
}
export function cloudDeployCommands(commit){
 if(!/^[0-9a-f]{40,64}$/.test(commit))throw new Error('A committed source revision is required.');
 return [['scripts/check.mjs'],['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--remote','--config','wrangler.jsonc'],['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.jsonc','--var','BUILD_COMMIT:'+commit,'--tag',commit.slice(0,12)]];
}
function main(){
 function git(args){const result=spawnSync('git',['-c','safe.directory='+process.cwd().replaceAll('\\','/'),...args],{encoding:'utf8'});if(result.error||result.status!==0)throw new Error('Cannot verify committed source.');return result.stdout.trimEnd();}
 const commit=git(['rev-parse','HEAD']);
 const changed=git(['status','--porcelain','--untracked-files=all']).split('\n').filter(Boolean);
 if(changed.some(line=>line.slice(3)!=='wrangler.jsonc'))throw new Error('Uncommitted source changes prevent deployment. Commit application changes first.');
 validateProvisioningMutation(parse(git(['show','HEAD:wrangler.jsonc'])),parse(readFileSync('wrangler.jsonc','utf8')));
 for(const args of cloudDeployCommands(commit)){
  const result=spawnSync(process.execPath,args,{stdio:'inherit',env:{...process.env,CI:'true'}});
  if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
