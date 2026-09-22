import { uiCopy } from './copy.ts';
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const nonempty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
export class UiRequestError extends Error {
 readonly status:number;readonly rawResponse:string;readonly code:string|undefined;readonly headline:string;readonly action:string;readonly details:unknown;
 constructor(status:number,rawResponse:string,known?:{code:string;headline:string;action:string;details?:unknown}){
  super(known?.headline??uiCopy.unrecognizedApiError);this.name='UiRequestError';this.status=status;this.rawResponse=rawResponse;this.code=known?.code;this.headline=known?.headline??uiCopy.unrecognizedApiError;this.action=known?.action??uiCopy.errorAction;this.details=known?.details;
 }
}
/** Render server-provided wording only from the known envelope; retain every raw response for inspection. */
export function parseRequestFailure(status:number,rawResponse:string):UiRequestError {
 let parsed:unknown;try{parsed=JSON.parse(rawResponse);}catch{/* Unknown response remains visible as raw technical detail below. */}
 const error=object(parsed)&&object(parsed.error)?parsed.error:null;
 if(error&&nonempty(error.code)&&nonempty(error.headline)&&nonempty(error.action))return new UiRequestError(status,rawResponse,{code:error.code,headline:error.headline,action:error.action,...(Object.hasOwn(error,'details')?{details:error.details}:{})});
 return new UiRequestError(status,rawResponse);
}
export function errorPresentation(error:unknown):{headline:string;action:string;technical:Record<string,unknown>} {
 if(error instanceof UiRequestError)return{headline:error.headline,action:error.action,technical:{status:error.status,...(error.code===undefined?{}:{code:error.code}),...(error.details===undefined?{}:{details:error.details}),rawResponse:error.rawResponse}};
 return{headline:uiCopy.error,action:uiCopy.errorAction,technical:error instanceof Error?{...error,message:error.message}:{value:error}};
}
