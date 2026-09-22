import type { DigestInput } from '../digest/digest.ts';
import { ServerFailure } from './errors.ts';
export interface Upload {
 fingerprint:string;originalFilename:string;fullText:string;outline:DigestInput;
 extractorVersion:string;parserVersions:Record<string,string>;needsOutlineRecovery:boolean;
 tokenCounts:{readerInputTokens:number|null;confidenceInputTokens:number|null;recoveryInputTokens:number|null};
 tokenizerIds:{reader:string|null;confidence:string};
}
export const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function requireValue(condition:unknown, detail:string):asserts condition {if(!condition)throw new ServerFailure('E_REQUEST','request',detail);}
export function exact(v:Record<string,unknown>, keys:string[]):void {requireValue(Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),'Missing or unexpected request fields.');}
const string=(v:unknown):v is string=>typeof v==='string';
const position=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
export function identity(value:Record<string,unknown>):void {
 requireValue(string(value.fingerprint)&&/^[a-f0-9]{64}$/.test(value.fingerprint),'A full SHA-256 fingerprint is required.');
 requireValue(string(value.originalFilename)&&value.originalFilename.length>0&&!/[\/\\\u0000]/.test(value.originalFilename),'A filename without a path is required.');
}
export function parseUpload(raw:unknown):Upload {
 requireValue(object(raw),'A JSON document object is required.');
 exact(raw,['fingerprint','originalFilename','fullText','outline','extractorVersion','parserVersions','needsOutlineRecovery','tokenCounts','tokenizerIds']);identity(raw);
 requireValue(string(raw.fullText)&&raw.fullText.length>0,'Extracted text is required.');
 requireValue(string(raw.extractorVersion)&&raw.extractorVersion.length>0,'Extractor version is required.');
 requireValue(object(raw.parserVersions)&&Object.values(raw.parserVersions).every(v=>string(v)&&v.length>0),'Parser versions are required.');
 requireValue(typeof raw.needsOutlineRecovery==='boolean','Outline recovery need must be explicit.');
 requireValue(object(raw.tokenCounts),'Token counts are required.');exact(raw.tokenCounts,['readerInputTokens','confidenceInputTokens','recoveryInputTokens']);
 requireValue(Object.values(raw.tokenCounts).every(v=>v===null||position(v)),'Token counts must be nonnegative integers or explicit null when unknown.');
 requireValue(object(raw.tokenizerIds),'Tokenizer IDs are required.');exact(raw.tokenizerIds,['reader','confidence']);requireValue(string(raw.tokenizerIds.confidence)&&raw.tokenizerIds.confidence.length>0&&(raw.tokenizerIds.reader===null||string(raw.tokenizerIds.reader)&&raw.tokenizerIds.reader.length>0),'Digest tokenizer must be explicit; reader tokenizer may be null.');
 requireValue(object(raw.outline),'Outline is required.');
 requireValue(Object.keys(raw.outline).every(k=>['title','headings','tables','blocks'].includes(k)),'Unexpected outline field.');
 const outline=raw.outline;
 requireValue(outline.title===undefined||string(outline.title),'Outline title must be text.');
 requireValue(Array.isArray(outline.headings)&&Array.isArray(outline.tables)&&Array.isArray(outline.blocks),'Outline arrays are required.');
 const ids=new Set<string>();
 for(const heading of outline.headings){requireValue(object(heading),'Invalid heading.');exact(heading,['id','text','level','position']);requireValue(string(heading.id)&&!ids.has(heading.id)&&string(heading.text)&&Number.isSafeInteger(heading.level)&&Number(heading.level)>0&&position(heading.position),'Invalid heading.');ids.add(heading.id);}
 for(const table of outline.tables){requireValue(object(table),'Invalid table.');exact(table,['position','headers']);requireValue(position(table.position)&&Array.isArray(table.headers)&&table.headers.every(string),'Invalid table.');}
 for(const block of outline.blocks){requireValue(object(block),'Invalid block.');requireValue(Object.keys(block).every(k=>['position','text','headingId'].includes(k))&&position(block.position)&&string(block.text)&&(block.headingId===undefined||string(block.headingId)&&ids.has(block.headingId)),'Invalid text block.');}
 return raw as unknown as Upload;
}
export function validateManifestReady(status:string,expected:number,completed:number):void {
 if(!['complete','closed'].includes(status)||expected!==completed)throw new ServerFailure('E_MANIFEST_INCOMPLETE','request','Every document must have an outcome before a manifest is produced.',409);
}
/** Bounded parsing prevents an untrusted body from exhausting the Worker isolate. No truncation. */
export async function jsonBody(request:Request):Promise<unknown>{
 requireValue(request.headers.get('content-type')?.split(';')[0]==='application/json','Only JSON text and outline requests are accepted.');
 requireValue(request.body,'A request body is required.');
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>32*1024*1024){await reader.cancel();throw new ServerFailure('E_REQUEST_MEMORY','request','The JSON request exceeds the Worker memory-safe upload envelope.',413);}chunks.push(part.value);}
 const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(joined));}catch{throw new ServerFailure('E_REQUEST_JSON','request','The request is not valid JSON.');}
}