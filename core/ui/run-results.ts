import {uiCopy} from './copy.ts';
export interface RunDocumentPresentation {fingerprint:string;filename:string;outcome:string;tone:''|'filed'|'review'|'failed';reason:string;destination:string;priority:string;rule:string}
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const str=(value:unknown)=>typeof value==='string'?value:'';
type ResultCopy = { [K in keyof typeof uiCopy as K extends `result${string}` ? K : never]: K extends 'resultReasons' ? Record<string,string> : string };
export function presentRunDocuments(documents:readonly Record<string,unknown>[],copy:ResultCopy=uiCopy):RunDocumentPresentation[]{
 return documents.map((document,index)=>{
  const decision=record(document.decision)?document.decision:null,rule=str(decision?.ruleId);
  const known=['R0','R0n','R1','R2','R3','R4','R5'].includes(rule);
  const tone:RunDocumentPresentation['tone']=!known?'':rule==='R1'?'filed':rule==='R0'?'failed':'review';
  const outcome=known?(tone==='filed'?copy.resultFiled:tone==='failed'?copy.resultFailed:copy.resultReview):document.status==='running'?copy.resultPending:document.status==='uploaded'?copy.resultUploaded:document.status==='queued'?copy.resultQueued:copy.resultUnavailable;
  const reasons=copy.resultReasons as Record<string,string>;const details:string[]=[];
  if(known)details.push(reasons[str(decision?.reasonCode)]??copy.resultDetailsUnavailable);
  if(typeof document.failure_json==='string'){
   try{const failure:unknown=JSON.parse(document.failure_json);if(record(failure))details.push([str(failure.code),str(failure.message)].filter(Boolean).join(': '));else details.push(copy.resultDetailsUnavailable);}
   catch{details.push(copy.resultDetailsUnavailable);}
  }
  for(const key of ['failures','notes'])if(Array.isArray(decision?.[key]))details.push(...(decision[key] as unknown[]).filter((value):value is string=>typeof value==='string'));
  return{index,first:rule==='R5',fingerprint:str(document.fingerprint),filename:str(document.original_filename)||str(document.originalFilename)||str(document.fingerprint),outcome,tone,reason:[...new Set(details.filter(Boolean))].join(' '),destination:known?str(decision?.destinationFolder):'',priority:rule==='R5'?copy.resultPriority:'',rule:known?rule:''};
 }).sort((a,b)=>Number(b.first)-Number(a.first)||a.index-b.index).map(({index,first,...row})=>row);
}
