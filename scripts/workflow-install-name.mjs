import {createHash,randomUUID} from 'node:crypto';
import {writeFileSync,unlinkSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
export const NEW_INSTALL_WORKFLOW_MARKER='doc-classifier-new-install-workflow-v1';
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
/** Only the new-install marker opts into derivation. Existing names never migrate implicitly. */
export function deriveWorkflowNames(source){
 if(!source||typeof source!=='object'||Array.isArray(source))throw new Error('A Wrangler configuration object is required.');
 const config=structuredClone(source);let rewritten=false;
 if(config.workflows!==undefined&&!Array.isArray(config.workflows))throw new Error('Workflow configuration must be an array.');
 for(const workflow of config.workflows??[]){
  if(workflow.name!==NEW_INSTALL_WORKFLOW_MARKER)continue;
  if(!nonempty(config.name)||!nonempty(workflow.binding))throw new Error('Selected Worker name and Workflow binding are required for new-install naming.');
  workflow.name=createHash('sha256').update(JSON.stringify(['doc-classifier-workflow-name-v1',config.name,workflow.binding])).digest('hex');rewritten=true;
 }
 return{config,rewritten};
}
/** Synchronous deployment callback; a sibling config preserves all Wrangler relative-path semantics. */
export function withWorkflowDeployConfig(sourcePath,source,action){
 const {config,rewritten}=deriveWorkflowNames(source),original=resolve(sourcePath);if(!rewritten)return action(original);
 const generated=join(dirname(original),'.wrangler-install-'+randomUUID()+'.jsonc');
 writeFileSync(generated,JSON.stringify(config,null,2)+'\n',{encoding:'utf8',flag:'wx'});
 try{return action(generated);}finally{unlinkSync(generated);}
}
