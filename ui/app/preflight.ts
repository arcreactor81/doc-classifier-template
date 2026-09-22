import { activeUiCopy as c } from '../../core/ui/project-copy.ts';
import { prepareLocalRun } from '../../core/local/preflight.ts';
import { requireProject, typeVersion } from '../../core/config/project.ts';
import { estimatePreparedRun, type LocalEstimate } from '../../core/local/run-estimate.ts';
import { LocalRunStore } from '../../core/local/state.ts';
import { readRetrySession, assertRetryComplete } from '../../core/local/retry.ts';

interface Quote { quoteId: string; typeVersion: string; estimate: { worstCaseNanodollars: string; estimateNanodollars: string }; projectLimitNanodollars: string; duration: { interactiveMinimumSecondsAtPublishedLimits: number|null; batchMaximumHours: number }; mode: string }
interface Options { ready: boolean; request<T>(path: string, body?: unknown): Promise<T>; onError(error: unknown): void; onRun(id: string): void }
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
/** Controls only: requests run solely after an explicit user click and successful verified preflight. */
export function attachRunPreflight(host: HTMLElement, mode: HTMLSelectElement, options: Options): void {
  let quote: LocalEstimate | null = null, quotedLocalId = '', quotedDocuments = '', quotedPack = '', quotedType = '', busy = false;
  const output = element('div'), notice = element('p', c.uploadUnavailable), overrideLabel = element('label'), override = element('input'), warning = element('p', c.overrideWarning);
  override.type = 'checkbox'; overrideLabel.append(override, document.createTextNode(c.override)); warning.hidden = true;
  const session = () => localStorage.getItem('local-extraction-run');
  function action(label: string, work: () => Promise<void>): HTMLButtonElement {
    const button = element('button', label); button.type = 'button';
    button.onclick = () => { busy = true; update(); void work().catch(options.onError).finally(() => { busy = false; update(); }); };
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
        let completed = 0;
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
    const money=(nano:string)=>'$'+(Number(nano)/1e9).toFixed(6);
    output.replaceChildren(element('p',c.expected+': '+money(result.estimate.estimateNanodollars)),element('p',c.ceiling+': '+money(result.estimate.worstCaseNanodollars)),element('p',c.budgetLimit+': '+money(result.projectLimitNanodollars)),element('p',c.projectedDuration+': '+(result.duration.interactiveMinimumSecondsAtPublishedLimits===null?c.durationUnavailable:result.duration.interactiveMinimumSecondsAtPublishedLimits+' s')),element('p',c.batchDuration+': '+result.duration.batchMaximumHours+' h'));
    if(result.mode==='batch'&&result.batchCapacity.allowance===null)output.append(element('p',c.batchCapacityUnknown));
  }
  async function refreshLocalEstimate(localId:string):Promise<void>{
    quote=null;const {items,pack}=await prepared(localId),documents=items.map(item=>item.quote);
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
    if(JSON.stringify(pack)!==quotedPack){override.checked=false;await refreshLocalEstimate(quotedLocalId);throw new Error(c.estimateChanged);}
    // This explicit confirmation is the first point at which any extracted-document metadata is sent.
    const server=await options.request<Quote>('/api/quote',{documents,mode:quote.mode});
    if(server.typeVersion!==quotedType||server.estimate.worstCaseNanodollars!==quote.estimate.worstCaseNanodollars||server.estimate.estimateNanodollars!==quote.estimate.estimateNanodollars||server.projectLimitNanodollars!==quote.projectLimitNanodollars||server.mode!==quote.mode||server.duration.interactiveMinimumSecondsAtPublishedLimits!==quote.duration.interactiveMinimumSecondsAtPublishedLimits||server.duration.batchMaximumHours!==quote.duration.batchMaximumHours){
      override.checked=false;await refreshLocalEstimate(quotedLocalId);output.append(element('p',c.estimateChanged));throw new Error(c.estimateChanged);
    }
    const created=await options.request<{runId:string}>('/api/runs',{quoteId:server.quoteId,override:override.checked});
    localStorage.setItem('server-run:'+quotedLocalId,created.runId);await uploadAndStart(quotedLocalId,created.runId);
  });
  confirm.className = 'primary';
  const resume = action(c.resumeUpload, async () => { const localId = session(), runId = localId && localStorage.getItem('server-run:' + localId); if (!localId || !runId) throw new Error(c.chooseFirst); await uploadAndStart(localId, runId); });
  function update(): void {
    const exceeds = quote ? BigInt(quote.estimate.worstCaseNanodollars) > BigInt(quote.projectLimitNanodollars) : false;
    const alreadyConfirmed = !!session() && !!localStorage.getItem('server-run:' + session());
    estimate.disabled = busy || !options.ready || alreadyConfirmed; confirm.disabled = busy || !options.ready || alreadyConfirmed || !quote || (exceeds && !override.checked);
    override.disabled = busy || !quote; warning.hidden = !override.checked; mode.disabled = busy;
    resume.hidden = !session() || !localStorage.getItem('server-run:' + session()); resume.disabled = busy || !options.ready;
    notice.hidden = !!quote;
  }
  function invalidate(): void { quote = null; quotedLocalId = ''; quotedDocuments = ''; quotedPack = ''; quotedType = ''; override.checked = false; output.replaceChildren(); update(); }
  mode.addEventListener('change', invalidate); override.addEventListener('change', update);
  const changed = () => { if (!host.isConnected) { window.removeEventListener('local-extraction-changed', changed); return; } invalidate(); };
  window.addEventListener('local-extraction-changed', changed);
  const actions = element('div'); actions.className = 'actions'; actions.append(estimate, confirm, resume);
  host.append(output, overrideLabel, warning, notice, actions); update();
}
