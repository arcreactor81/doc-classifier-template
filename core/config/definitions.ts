import type {TypeFile} from './project.ts';
export type ThresholdStatus='untested'|'unverified'|'calibrated';
export type DefinitionChange='initial'|'semantic'|'cosmetic';
export interface Calibration {threshold:number;status:ThresholdStatus}
export function definitionChange(base:TypeFile|null,next:TypeFile):DefinitionChange{return !base?'initial':JSON.stringify(base)===JSON.stringify(next)?'cosmetic':'semantic';}
export function definitionThreshold(kind:DefinitionChange,base:Calibration|null,inherit:boolean):Calibration{if(kind==='cosmetic'&&base)return {...base};if(kind==='semantic'&&base&&inherit)return {threshold:base.threshold,status:'unverified'};return {threshold:.90,status:'untested'};}
export function editorAllowed(raw:string|undefined,actor:string):boolean{try{const list:unknown=JSON.parse(raw??'[]');return Array.isArray(list)&&list.every(item=>typeof item==='string'&&item.length>0)&&list.includes(actor);}catch{return false;}}
export function validateDisplayNames(value:unknown,types:TypeFile):asserts value is Record<string,string>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Display names must be an object.');const ids=new Set(types.types.map(t=>t.id));for(const [id,name] of Object.entries(value)){if(!ids.has(id)||typeof name!=='string'||!name.trim())throw new Error('Each display name must name an existing category and contain text.');}}
