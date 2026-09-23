import assets from 'bundled-ui';
import {serveBundledAssets} from './bundled-assets.ts';
import {handleManagedRequest} from './managed-handler.ts';
import {handleWithCloudflareIdentity} from './api.ts';
export {DocumentWorkflow} from './workflow.ts';
// No Static Assets binding: its router does not forward the trusted Access context.
export default {fetch(request,env,ctx){
 return handleManagedRequest(request,env,ctx.access,{assets:request=>serveBundledAssets(request,assets),api:handleWithCloudflareIdentity});
}} satisfies ExportedHandler<Env>;
