import { suggestRunMode,type RunMode,type ModeSettings } from '../../core/ui/run-mode.ts';
﻿import { activeUiCopy as c } from '../../core/ui/project-copy.ts';
import { prepareLocalRun } from '../../core/local/preflight.ts';
import { requireProject, typeVersion } from '../../core/config/project.ts';
import { estimatePreparedRun, type LocalEstimate } from '../../core/local/run-estimate.ts';
import { budgetFromInputs, type SpendKey } from '../../core/ui/run-budget.ts';
import { LocalRunStore } from '../../core/local/state.ts';
import { readRetrySession, assertRetryComplete } from '../../core/local/retry.ts';

interface Quote { quoteId: string; typeVersion: string; mode: string }
interface Options { ready: boolean; request<T>(path: string, body?: unknown): Promise<T>; onError(error: unknown): void; onRun(id: string): void }
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
/** Controls only: requests run solely after an explicit user click and successful verified preflight. */
export function attachRunPreflight(host: HTMLElement, mode: HTMLSelectElement, options: Options): void {
  let modeSettings:ModeSettings|null=null, selectedCount:number|null=null, userMode:RunMode|null=null, selectionEpoch=0;
  mode.value='';
  let quote: LocalEstimate | null = null, quotedLocalId = '', quotedDocuments = '', quotedPack = '', quotedType = '', busy = false;
  const output = element('div'), notice = element('p', c.uploadUnavailable);
  const budgetBox=element('fieldset');budgetBox.className='budget-controls';budgetBox.append(element('legend',c.budgetTitle));
  const budgetMode=element('select');budgetMode.id='budget-mode';const budgetModeLabel=element('label',c.budgetMode);budgetModeLabel.htmlFor=budgetMode.id;
  for(const [value,text]of [['limited',c.budgetLimited],['unlimited',c.budgetUnlimited]]){const item=element('option',text);item.value=value;budgetMode.append(item);}
  budgetBox.append(budgetModeLabel,budgetMode);const limitFields=element('div');limitFields.append(element('p',c.budgetHelp));
  const inputs={} as Record<SpendKey,HTMLInputElement>;
  for(const [key,title]of [['blended',c.budgetBlended],['openai',c.budgetOpenai],['typesafe',c.budgetTypesafe]] as const){const input=element('input');input.type='text';input.inputMode='decimal';input.id='budget-'+key;const label=element('label',title+' \u00b7 '+c.budgetUsd);label.htmlFor=input.id;limitFields.append(label,input);inputs[key]=input;}
  const warning=element('div');warning.className='budget-warning';warning.setAttribute('role','alert');warning.hidden=true;
  const acknowledge=element('input');acknowledge.type='checkbox';const acknowledgeLabel=element('label');acknowledgeLabel.append(acknowledge,document.createTextNode(c.unlimitedAcknowledgement));warning.append(element('p',c.overrideWarning),acknowledgeLabel);
  const budgetError=element('p');budgetError.className='muted';budgetError.setAttribute('aria-live','polite');budgetBox.append(limitFields,warning,budgetError,element('p',c.spendingLag));
  function readBudget(){return budgetFromInputs(budgetMode.value as 'limited'|'unlimited',{blended:inputs.blended.value,openai:inputs.openai.value,typesafe:inputs.typesafe.value},acknowledge.checked);}
  const session = () => localStorage.getItem('local-extraction-run');
  function action(label: string, work: () => Promise<void>): HTMLButtonElement {
    const button = element('button', label); button.type = 'button';
    button.onclick = () => { busy = true; notice.textContent=c.loading; update(); void work().catch(options.onError).finally(() => { busy = false; update(); }); };
    return button;
  }
  async function prepared(localId: string) {
    const pack = requireProject(await options.request('/api/project')); const store = await LocalRunStore.open();
    try { const records=await store.list(localId);const retry=readRetrySession(localStorage,localId);if(retry){assertRetryComplete(retry,records);const missing=JSON.parse(localStorage.getItem('retry-missing:'+localId)??'[]');if(!Array.isArray(missing)||missing.length)throw new Error(c.retryMissing);}const result = prepareLocalRun(records, pack); if (!result.length) throw new Error(c.chooseFirst); return {items:result,pack}; }
    finally { store.close(); }
  }
  async function uploadAndStart(localId: string, runId: string): Promise<void> {
    const { run } = await options.request<{ run: { status: string } }>('/api/runs/' + encodeURIComponent(runId));
    if (!['uploading', 'running'].includes(run.status)) { options.onRun(runId); return; }
    if (run.status === 'uploading') {
      const {items} = await prepared(localId), store = await LocalRunStore.open();
      try {
        let completed = 0;notice.textContent=c.uploads+': 0 / '+items.length;
        for (const item of items) {
          if (item.local.state !== 'uploaded') {
            await options.request('/api/runs/' + encodeURIComponent(runId) + '/documents', item.upload);
            if (item.local.state === 'extracted') await store.put({ ...item.local, state: 'uploaded' });
          }
          completed++; notice.textContent = c.uploads + ': ' + completed + ' / ' + items.length;
        }
      } finally { store.close(); }
    }
    let pending: number;
    do {
      const launched = await options.request<{ started: number; pending: number }>('/api/runs/' + encodeURIComponent(runId) + '/start', {});
      pending = launched.pending;
      if (!Number.isSafeInteger(pending) || pending < 0) throw new Error(c.requestFailed);
      if (pending > 0) await new Promise(resolve => setTimeout(resolve, 1000));
    } while (pending > 0);
    options.onRun(runId);
  }
  function displayEstimate(result:LocalEstimate):void{
    output.replaceChildren(element('p',c.projectedDuration+': '+(result.duration.interactiveMinimumSecondsAtPublishedLimits===null?c.durationUnavailable:result.duration.interactiveMinimumSecondsAtPublishedLimits+' s')),element('p',c.batchDuration+': '+result.duration.batchMaximumHours+' h'));
    if(result.mode==='batch'&&result.batchCapacity.allowance===null)output.append(element('p',c.batchCapacityUnknown));
  }
  async function refreshLocalEstimate(localId:string):Promise<void>{
    quote=null;const {items,pack}=await prepared(localId),documents=items.map(item=>item.quote);
    modeSettings=pack.settings;selectedCount=documents.length;mode.value=suggestRunMode(modeSettings,selectedCount,userMode);
    quote=estimatePreparedRun(documents,pack,mode.value as 'interactive'|'batch');quotedLocalId=localId;quotedDocuments=JSON.stringify(documents);quotedPack=JSON.stringify(pack);quotedType=await typeVersion(JSON.stringify(pack.typeFile));displayEstimate(quote);
  }
  const estimate=action(c.quoteAction,async()=>{
    invalidate();const localId=session();if(!localId)throw new Error(c.chooseFirst);if(localStorage.getItem('server-run:'+localId))throw new Error(c.alreadyConfirmed);
    await refreshLocalEstimate(localId);if(session()!==localId){invalidate();throw new Error(c.extractionIncomplete);}
  });
  const confirm=action(c.confirm,async()=>{
    if(!quote||session()!==quotedLocalId)throw new Error(c.chooseFirst);
    if(localStorage.getItem('server-run:'+quotedLocalId))throw new Error(c.alreadyConfirmed);
    const {items,pack}=await prepared(quotedLocalId),documents=items.map(item=>item.quote);
    if(JSON.stringify(documents)!==quotedDocuments){invalidate();throw new Error(c.extractionIncomplete);}
    if(JSON.stringify(pack)!==quotedPack){acknowledge.checked=false;await refreshLocalEstimate(quotedLocalId);throw new Error(c.estimateChanged);}
    const budget=readBudget();
    // This explicit confirmation is the first point at which any extracted-document metadata is sent.
    const server=await options.request<Quote>('/api/quote',{documents,mode:quote.mode});
    if(server.typeVersion!==quotedType||server.mode!==quote.mode){
      acknowledge.checked=false;await refreshLocalEstimate(quotedLocalId);output.append(element('p',c.estimateChanged));throw new Error(c.estimateChanged);
    }
    const created=await options.request<{runId:string}>('/api/runs',{quoteId:server.quoteId,budget});
    localStorage.setItem('server-run:'+quotedLocalId,created.runId);await uploadAndStart(quotedLocalId,created.runId);
  });
  confirm.className = 'primary';
  const resume = action(c.resumeUpload, async () => { const localId = session(), runId = localId && localStorage.getItem('server-run:' + localId); if (!localId || !runId) throw new Error(c.chooseFirst); await uploadAndStart(localId, runId); });
  function update(): void {
    let validBudget=false;try{readBudget();validBudget=true;budgetError.textContent='';}catch(error){budgetError.textContent=error instanceof Error?error.message:c.invalidBudget;}
    const alreadyConfirmed = !!session() && !!localStorage.getItem('server-run:' + session());
    estimate.disabled = busy || !options.ready || alreadyConfirmed; confirm.disabled = busy || !options.ready || alreadyConfirmed || !quote || !validBudget;
    budgetBox.disabled=busy;warning.hidden=budgetMode.value!=='unlimited';limitFields.hidden=budgetMode.value==='unlimited';mode.disabled=busy;
    resume.hidden = !session() || !localStorage.getItem('server-run:' + session()); resume.disabled = busy || !options.ready;
    notice.hidden = !!quote && !busy;
    if(!busy&&!quote)notice.textContent=c.uploadUnavailable;
  }
  function invalidate(): void { quote = null; quotedLocalId = ''; quotedDocuments = ''; quotedPack = ''; quotedType = ''; acknowledge.checked = false; output.replaceChildren(); update(); }
  mode.addEventListener('change',()=>{userMode=mode.value as RunMode;invalidate();});budgetMode.addEventListener('change',()=>{acknowledge.checked=false;update();});acknowledge.addEventListener('change',update);for(const input of Object.values(inputs))input.addEventListener('input',update);
  const changed = () => { if (!host.isConnected) { window.removeEventListener('local-extraction-changed', changed); return; } selectionEpoch++;userMode=null;selectedCount=null;if(modeSettings)mode.value=suggestRunMode(modeSettings,null);invalidate(); };
  window.addEventListener('local-extraction-changed', changed);
  const counted=(event:Event)=>{if(!host.isConnected){window.removeEventListener('local-extraction-count',counted);return;}selectedCount=(event as CustomEvent<number>).detail;if(modeSettings)mode.value=suggestRunMode(modeSettings,selectedCount,userMode);invalidate();};
  window.addEventListener('local-extraction-count',counted);
  const actions = element('div'); actions.className = 'actions'; actions.append(estimate, confirm, resume);
  host.append(output, budgetBox, notice, actions); update();
  const initialEpoch=selectionEpoch;void options.request('/api/project').then(raw=>{const settings=(raw as {settings?:ModeSettings}|null)?.settings;if(!settings)throw new Error(c.setupDetail);suggestRunMode(settings,null);modeSettings=settings;if(initialEpoch===selectionEpoch)mode.value=suggestRunMode(modeSettings,selectedCount,userMode);else if(!userMode)mode.value=suggestRunMode(modeSettings,selectedCount);}).catch(options.onError);
}
