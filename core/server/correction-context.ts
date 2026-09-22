export interface RetainedDigestContext {policyVersion:string;state:{title:string;sections:{text:string}[]}}
/** Complete source text must not be copied into retained correction artifacts. */
export async function correctionContext(filename:string,key:string|null,artifacts:{deleted(key:string):Promise<boolean>;read(key:string):Promise<RetainedDigestContext>}):Promise<{title:string;digestLines:string[];unavailable:boolean}>{
 const absent={title:filename,digestLines:[],unavailable:true};
 if(!key||await artifacts.deleted(key))return absent;
 const digest=await artifacts.read(key);
 if(digest.policyVersion==='untrimmed-structured-state-v2')return absent;
 if(digest.policyVersion!=='named-fields-json-v1')throw new Error('Unknown retained state policy.');
 return{title:digest.state.title,digestLines:digest.state.sections.map(section=>section.text),unavailable:false};
}
