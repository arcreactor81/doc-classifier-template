import {uiCopy} from './copy.ts';
export type RunMode='interactive'|'batch';
export interface ModeSettings {defaultMode:RunMode;batchCutoff:number}
export function suggestRunMode(settings:ModeSettings,count:number|null,choice:RunMode|null=null):RunMode{
 if(!settings||!['interactive','batch'].includes(settings.defaultMode)||!Number.isSafeInteger(settings.batchCutoff)||settings.batchCutoff<1||count!==null&&(!Number.isSafeInteger(count)||count<0))throw new Error(uiCopy.setupDetail);
 return choice??(count!==null&&count>=settings.batchCutoff?'batch':settings.defaultMode);
}
