import './style.css';
import { attachRunPreflight } from './preflight.ts';
import { browserSupported } from '../../core/extraction/policy.ts';
import type { CorrectionProposals, FolderDecision } from '../../core/correction/proposals.ts';
import type { CorrectionDiff } from '../../core/correction/diff.ts';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ExtractionPool } from '../../core/extraction/pool.ts';
import { LocalRunStore, resumeAction } from '../../core/local/state.ts';
import { createRetrySession, readRetrySession, matchRetrySources, type RetryDocument } from '../../core/local/retry.ts';
import { activeUiCopy as c, configureProjectCopy } from '../../core/ui/project-copy.ts';
import { builderCopy } from '../../core/builder/copy.ts';
import { buildTree, planTree, sha256, type BuilderManifest } from '../../core/builder/builder.ts';
import { browserDestination, scanSourceFolder, type LocalDirectoryHandle } from '../../core/builder/browser.ts';

type Page = keyof typeof c.nav;
type Json = Record<string, unknown>;
interface Health { status: 'READY' | 'NOT READY'; blockers: { code: string; headline: string; action: string; details?: unknown }[]; versions: Json; project?: Json; modelCallsEnabled: boolean; textHeldRuns: number }
interface PickerWindow extends Window { showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<LocalDirectoryHandle> }
document.title = c.product;
const root = document.querySelector<HTMLDivElement>('#app')!;
let page: Page = 'home'; let activeRun = ''; let health: Health | null = null; let renderId = 0; let poll: ReturnType<typeof setTimeout> | undefined;
let loadedManifest: BuilderManifest | null = null;
let pendingRetryFolder: LocalDirectoryHandle | null = null;
const supported = browserSupported(navigator.userAgent, 'showDirectoryPicker' in window);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
function button(label: string, action: () => Promise<void> | void, primary = false): HTMLButtonElement { const node = el('button', label, primary ? 'primary' : ''); node.type = 'button'; node.onclick = () => { node.disabled = true; Promise.resolve().then(action).catch(error=>{if(!(error instanceof DOMException && error.name==='AbortError'))showError(error);}).finally(() => { if (node.isConnected) node.disabled = false; }); }; return node; }
function section(title: string, description?: string): HTMLElement { const box = el('section', undefined, 'card'); box.append(el('h2', title)); if (description) box.append(el('p', description, 'muted')); return box; }
function technical(value: unknown, label: string = c.details): HTMLDetailsElement { const d = el('details'); d.append(el('summary', label), el('pre', typeof value === 'string' ? value : JSON.stringify(value, null, 2))); return d; }
function showError(error: unknown): void { const host = document.querySelector('main'); if (!host) return; const box = section(c.error, c.errorAction); box.classList.add('error'); box.setAttribute('role', 'alert'); box.append(technical(error instanceof Error ? { ...error, message: error.message } : error)); host.prepend(box); }
async function api<T = Json>(path: string, body?: unknown): Promise<T> { const response = await fetch(path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw Object.assign(new Error(c.requestFailed), { status: response.status, response: await response.text() }); return await response.json() as T; }
function field(container: HTMLElement, label: string, type = 'text', value = ''): HTMLInputElement { const id = crypto.randomUUID(); const text = el('label', label); text.htmlFor = id; const input = el('input'); input.id = id; input.type = type; input.value = value; container.append(text, input); return input; }
function stat(container: HTMLElement, label: string, value: string): void { const node = el('div', undefined, 'stat'); node.append(el('strong', value), el('span', label)); container.append(node); }
function table(headers: string[], rows: string[][]): HTMLElement { const wrap = el('div', undefined, 'scroll'); const t = el('table'); const head = el('thead'); const tr = el('tr'); headers.forEach(label => { const th = el('th', label); th.scope = 'col'; tr.append(th); }); head.append(tr); t.append(head); const body = el('tbody'); rows.forEach(row => { const item = el('tr'); row.forEach(value => item.append(el('td', value))); body.append(item); }); t.append(body); wrap.append(t); return wrap; }
function intro(main: HTMLElement, title: string, lede?: string): void { main.append(el('h1', title)); if (lede) main.append(el('p', lede, 'lede')); }
function blockers(main: HTMLElement): void { if (!health || health.status === 'READY') return; const box = section(c.setup, c.setupDetail); const list = el('ol'); for (const blocker of health.blockers) { const item = el('li'); item.append(el('strong', blocker.headline), el('p', blocker.action), technical({ code: blocker.code, details: blocker.details })); list.append(item); } box.append(list); main.append(box); }
async function pickDirectory(write = false): Promise<LocalDirectoryHandle> { return (window as unknown as PickerWindow).showDirectoryPicker({ mode: write ? 'readwrite' : 'read' }); }
async function chooseManifest(): Promise<BuilderManifest> { return new Promise((resolve, reject) => { const picker = el('input'); picker.type = 'file'; picker.accept = '.json,application/json'; picker.oncancel = () => reject(new DOMException(builderCopy.cancelled, 'AbortError')); picker.onchange = async () => { try { const file = picker.files?.[0]; if (!file) throw new Error(c.invalidManifest); const data = JSON.parse(await file.text()); if (!data || typeof data.runId !== 'string' || !Array.isArray(data.entries) || !data.entries.every((entry: Json) => typeof entry.fingerprint === 'string' && typeof entry.tag === 'string' && typeof entry.originalFilename === 'string' && typeof entry.destinationFolder === 'string')) throw new Error(c.invalidManifest); loadedManifest = data; resolve(data); } catch (e) { reject(e); } }; picker.click(); }); }
function route(next: Page, run = ''): void { location.hash = `${next}${run ? '/' + encodeURIComponent(run) : ''}`; }
async function home(main: HTMLElement): Promise<void> {
  if (!supported) { intro(main, c.browser, c.browserReason); return; }
  const note = el('p', c.browserReason, 'badge'); main.append(note); intro(main, c.hero, c.lede);
  const grid = el('div', undefined, 'grid'); const work = section(c.local, c.localDetail); const side = section(c.preflight, c.pendingEstimate);
  c.outcomes.forEach((text, i) => side.append(el('p', text, `outcome ${['filed','review','failed'][i]}`)));
  const output = el('div'); const extractChosen = async (folder: LocalDirectoryHandle) => {
    window.dispatchEvent(new Event('local-extraction-changed')); output.replaceChildren(el('p', `${c.source}: ${folder.name}`));
    const project = await api<{settings?:{pdfPolicy?:{largeFontRatio:number;maxHeadingCharacters:number;topPageFraction:number;gapRatio:number};recoveryMinimumHeadings?:number}}>('/api/project');
    const policy=project.settings?.pdfPolicy;const minimum=project.settings?.recoveryMinimumHeadings;
    if(!policy||minimum===undefined)throw new Error(c.setupDetail);
    const pool=new ExtractionPool(2,{pdfWorkerUrl,pdfPolicy:{largeFontRatio:policy.largeFontRatio,maximumHeadingCharacters:policy.maxHeadingCharacters,topPageFraction:policy.topPageFraction,gapRatio:policy.gapRatio,minimumHeadings:minimum},parserVersions:{zip:'2.17.0',xml:'5.11.1',pdf:'6.3.289'}});
    const store=await LocalRunStore.open();const localRunId=localStorage.getItem('local-extraction-run')??crypto.randomUUID();localStorage.setItem('local-extraction-run',localRunId);
    const start=performance.now();const progress=el('p',c.sourceScan);output.append(progress,el('p',`${c.runId}: ${localRunId}`));
    try {
      const scanned=await scanSourceFolder(folder,{onProgress:count=>{progress.textContent=c.files+': '+count;}});const previous=await store.list(localRunId);const retry=readRetrySession(localStorage,localRunId);let sources=scanned;const retryNames=new Map<string,string>();
      if(retry){const matching=matchRetrySources(retry,scanned);sources=matching.matched.map(item=>item.source);for(const item of matching.matched)retryNames.set(item.document.fingerprint,item.document.originalFilename);localStorage.setItem('retry-missing:'+localRunId,JSON.stringify(matching.missing.map(item=>item.fingerprint)));output.append(table([c.source,c.status],[...matching.missing.map(item=>[item.originalFilename,c.missingRetry]),...matching.excluded.map(item=>[item.path,c.excludedRetry])]));}
      else{const selectedPaths=new Set(sources.map(source=>source.path));if(previous.some(record=>!selectedPaths.has(record.sourcePath)))throw new Error(c.sourceSetChanged);}
      const previousByFingerprint=new Map(previous.map(record=>[record.fingerprint,record]));let completed=0;
      const rows:string[][]=[];
      const extractionResults=await Promise.allSettled(sources.map(async source=>{
        const recordPath=retry?(previousByFingerprint.get(source.fingerprint)?.sourcePath??source.path):source.path;const prior=await store.get(localRunId,recordPath);const action=resumeAction(prior,source.fingerprint);
        if(action==='extract'){
          await store.put({runId:localRunId,sourcePath:recordPath,fingerprint:source.fingerprint,state:'not started'});
          const parts=source.path.split('/');let directory=folder;for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part);
          const file=await(await directory.getFileHandle(parts.at(-1)!)).getFile();
          let document;
          try{document=await pool.extract(new File([file],retryNames.get(source.fingerprint)??parts.at(-1)!));}
          catch(error){const failure={code:String((error as {code?:string}).code??'E_EXTRACTION'),message:error instanceof Error?error.message:String(error)};await store.put({runId:localRunId,sourcePath:recordPath,fingerprint:source.fingerprint,state:'could_not_process',failure});rows.push([source.path,c.failure,failure.message]);}
          if(document){await store.put({runId:localRunId,sourcePath:recordPath,fingerprint:source.fingerprint,state:'extracted',document});rows.push([source.path,c.extracted,String(document.fullText.length)]);}
        }else rows.push([source.path,prior?.state??'',action==='failed'&&prior?.state==='could_not_process'?prior.failure.message:'']);
        completed++;progress.textContent=`${c.extraction}: ${completed} / ${sources.length} · ${c.duration}: ${((performance.now()-start)/1000).toFixed(1)} s`;
      }));
      const failures=extractionResults.filter((result):result is PromiseRejectedResult=>result.status==='rejected');
      output.append(table([c.source,c.status,c.details],rows));
      if(failures.length)throw new AggregateError(failures.map(f=>f.reason),c.error);
    }finally{pool.close();store.close();}
  };
  const select=button(c.chooseSource,async()=>extractChosen(await pickDirectory()),true);
  const sourceActions=el('div',undefined,'actions');sourceActions.append(select,button(c.newLocal,()=>{localStorage.setItem('local-extraction-run',crypto.randomUUID());window.dispatchEvent(new Event('local-extraction-changed'));output.replaceChildren(el('p',c.localSession));}));work.append(sourceActions,el('p',c.localSession,'muted'),output); const mode = el('select'); mode.id = 'mode'; for (const [value, label] of [['interactive',c.interactive],['batch',c.batch]]) { const option = el('option',label); option.value = value; mode.append(option); } const label = el('label', c.mode); label.htmlFor = mode.id; side.append(label,mode);
  attachRunPreflight(side,mode,{ready:health?.status==='READY'&&health.modelCallsEnabled,request:api,onError:showError,onRun:id=>route('runs',id)}); grid.append(work,side); main.append(grid); blockers(main);
  const currentLocal=localStorage.getItem('local-extraction-run');const retry=currentLocal?readRetrySession(localStorage,currentLocal):null;if(retry){const provenance=el('p',c.retryParent+': ');const link=el('a',retry.parentRunId);link.href='#runs/'+encodeURIComponent(retry.parentRunId);provenance.append(link);work.prepend(provenance);}
  if(pendingRetryFolder){const selected=pendingRetryFolder;pendingRetryFolder=null;await extractChosen(selected);}
}
async function runs(main: HTMLElement, generation: number): Promise<void> {
  intro(main,c.runs,c.runsLede);
  if (!activeRun) { const data = await api<{ runs: Json[] }>('/api/runs'); if (generation !== renderId) return; if (!data.runs.length) main.append(el('p',c.noRuns,'empty')); for (const run of data.runs) { const box = section(String(run.id)); const stats = el('div',undefined,'stats'); stat(stats,c.status,String(run.status)); stat(stats,c.progress,`${run.completed} / ${run.total}`); if(Number(run.unaccountedCalls)>0)box.append(el('p',c.unaccountedSpend+': '+run.unaccountedCalls));box.append(stats,button(c.nav.runs,()=>route('runs',String(run.id)))); main.append(box); } return; }
  const data = await api<{ run: Json; documents: Json[]; events: Json[] }>(`/api/runs/${encodeURIComponent(activeRun)}`); if(generation !== renderId)return;
  const run = data.run; const box = section(`${c.runId}: ${activeRun}`); const stats = el('div',undefined,'stats'); stat(stats,c.status,String(run.status)); stat(stats,c.progress,`${run.completed} / ${run.total}`); stat(stats,Number(run.unaccountedCalls)>0?c.knownSpend:c.spend,run.spendNano === undefined ? '—' : `$${(Number(run.spendNano)/1e9).toFixed(6)}`); box.append(stats);if(Number(run.unaccountedCalls)>0)box.append(el('p',c.unaccountedSpend+': '+run.unaccountedCalls)); const progress = el('progress'); progress.max = Number(run.total) || 1; progress.value = Number(run.completed) || 0; progress.setAttribute('aria-label',c.progress); box.append(progress,el('p',run.textHeld ? c.textHeld : c.textDeleted,'muted'));
  const actions = el('div',undefined,'actions'); const download = button(c.download,async()=>{ const response = await fetch(`/api/runs/${encodeURIComponent(activeRun)}/manifest`); if(!response.ok)throw new Error(await response.text()); const blob = await response.blob(); const url=URL.createObjectURL(blob); const a=el('a'); a.href=url; a.download=`manifest-${activeRun}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); await render(); },true); download.disabled = Number(run.completed)!==Number(run.total) || !Number(run.total); download.title=download.disabled?c.noManifest:''; actions.append(download,button(c.close,async()=>{await api(`/api/runs/${encodeURIComponent(activeRun)}/close`,{});await render();}),button(c.kill,async()=>{await api('/api/kill',{enabled:true});await render();})); box.append(actions,el('p',c.killDetail,'muted')); main.append(box);
  const retryDocuments:RetryDocument[]=data.documents.filter(item=>{const decision=item.decision as {ruleId?:string;outcome?:string}|null;return decision?.ruleId==='R0'&&decision.outcome==='could_not_process';}).map(item=>({fingerprint:String(item.fingerprint),originalFilename:String(item.originalFilename??item.original_filename)}));
  if(retryDocuments.length){const retryBox=section(c.retryFailed,c.retryDetail);retryBox.append(table([c.source],retryDocuments.map(item=>[item.originalFilename])),button(c.retryFailed,async()=>{if(!supported)throw new Error(c.browserReason);if(poll)clearTimeout(poll);const parentId=activeRun;const folder=await pickDirectory();const retry=createRetrySession(parentId,retryDocuments,new Date().toISOString(),crypto.randomUUID());localStorage.setItem('retry-session:'+retry.runId,JSON.stringify(retry));localStorage.setItem('local-extraction-run',retry.runId);pendingRetryFolder=folder;route('home');}));main.append(retryBox);}
  const docs=section(c.documents); docs.append(table([c.source,c.status,c.details],data.documents.map(d=>[String(d.originalFilename??d.filename??d.fingerprint),String(d.status??d.rule),String(d.reasoningNote??d.reason??'')]))); main.append(docs,technical(data.events,c.events));
  if(!['closed','complete','halted','failed'].includes(String(run.status)))poll=setTimeout(()=>void render(),5000);
}
async function build(main: HTMLElement): Promise<void> {
  intro(main,c.build,c.buildLede); if(!supported){main.append(el('p',c.browserReason));return;}
  const box=section(c.nav.build); const choices=el('div',undefined,'actions'); const status=el('div'); let source:LocalDirectoryHandle|null=null;let destination:LocalDirectoryHandle|null=null;let manifest=loadedManifest;let controller:AbortController|null=null;
  choices.append(button(c.manifest,async()=>{manifest=await chooseManifest();status.append(el('p',`${c.runId}: ${manifest.runId} · ${c.files}: ${manifest.entries.length}`));}),button(c.chooseSource,async()=>{source=await pickDirectory();status.append(el('p',`${c.source}: ${source.name}`));}),button(c.destination,async()=>{destination=await pickDirectory(true);status.append(el('p',`${c.destination}: ${destination.name}`));})); box.append(choices,status);
  const path=field(box,c.destinationPath); box.append(el('p',c.pathHelp,'muted'));const maxPath=field(box,c.maxPath,'number','260');const maxName=field(box,c.maxName,'number','255'); const naming=el('select');naming.id='naming';for(const [value,label] of [['original',c.original],['short',c.short]]){const o=el('option',label);o.value=value;naming.append(o);}const nl=el('label',c.naming);nl.htmlFor=naming.id;box.append(nl,naming);
  const output=el('div');const start=button(c.buildAction,async()=>{
    if(!source||!destination||!manifest)throw new Error(c.chooseFirst);
    const plan=planTree(manifest,{naming:naming.value as 'original'|'short',destinationPrefix:path.value,maxPathLength:Number(maxPath.value),maxComponentLength:Number(maxName.value)});
    output.replaceChildren();if(plan.warnings.length){output.append(el('p',builderCopy.longPath),technical(plan.warnings));return;}
    controller=new AbortController();const progress=el('progress');progress.max=manifest.entries.length||1;progress.value=0;const message=el('p',c.sourceScan);output.append(message,progress);
    const sources=await scanSourceFolder(source,{signal:controller.signal,onProgress:count=>{message.textContent=`${c.sourceScan}: ${count}`;}});
    const result=await buildTree(plan,sources,browserDestination(destination,navigator.locks),{signal:controller.signal,onProgress:(done,total)=>{progress.value=done;message.textContent=`${done} / ${total}`;}});
    output.append(el('p',result.complete?c.buildComplete:c.buildIncomplete),el('p',`${c.summary}: ${result.summaryPath}`),table([c.source,c.destination,c.status],result.entries.map(e=>[e.originalFilename,e.path,builderCopy.statuses[e.status]])));controller=null;
  },true);box.append(el('div',undefined,'actions'));box.lastElementChild!.append(start,button(c.stop,()=>controller?.abort()));box.append(output);main.append(box);
}
async function correct(main: HTMLElement): Promise<void> {
  intro(main,c.correct,c.correctLede);if(!supported){main.append(el('p',c.browserReason));return;}const box=section(c.nav.correct,c.noAutomatic);const run=field(box,c.correctionRun,'text',activeRun||loadedManifest?.runId||'');const choices=el('div',undefined,'actions');const output=el('div');const folders=el('fieldset');folders.append(el('legend',c.checked));let listing:Json[]=[];let sidecarPaths:string[]=[];const checked=new Map<string,HTMLInputElement>();
  choices.append(button(c.manifest,async()=>{const manifest=await chooseManifest();run.value=manifest.runId;}),button(c.tree,async()=>{
    const tree=await pickDirectory();listing=[];sidecarPaths=[];checked.clear();decisions.clear();folders.replaceChildren(el('legend',c.checked));const tags=loadedManifest?.entries.map(e=>e.tag)??[];
    async function walk(directory:LocalDirectoryHandle,prefix:string):Promise<void>{for await(const handle of directory.values()){if(handle.name==='__MACOSX')continue;const path=prefix?`${prefix}/${handle.name}`:handle.name;if(handle.kind==='directory'){await walk(handle,path);continue;}if(['.DS_Store','Thumbs.db'].includes(handle.name))continue;const sidecar=loadedManifest?.entries.some(e=>{const dot=e.originalFilename.lastIndexOf('.');const extension=dot>0?e.originalFilename.slice(dot):'';return handle.name===`${e.tag}--${e.originalFilename}.md`||handle.name===`${e.tag}${extension}.md`;});if(/^build-summary-[0-9a-f-]{36}\.md$/.test(handle.name)||sidecar){sidecarPaths.push(path);continue;}const tag=tags.find(tag=>handle.name.startsWith(`${tag}--`)||handle.name.startsWith(`${tag}.`));listing.push({folder:prefix,filename:handle.name,...(tag?{tag}:{fingerprint:await sha256(new Uint8Array(await(await handle.getFile()).arrayBuffer()))})});if(!checked.has(prefix)){const label=el('label');const input=el('input');input.type='checkbox';label.append(input,document.createTextNode(prefix||tree.name));folders.append(label);checked.set(prefix,input);}}}
    await walk(tree,'');output.replaceChildren(el('p',`${c.listing}: ${listing.length}`));
  }));const decisions=new Map<string,FolderDecision['action']>();
  async function submitCorrection():Promise<void>{
    if(!run.value||!listing.length)throw new Error(c.chooseFirst);
    const result=await api<{correctionId:string;diff:CorrectionDiff;proposals:CorrectionProposals}>(      '/api/runs/'+encodeURIComponent(run.value)+'/corrections',
      {files:listing,sidecarPaths,checkedFolders:Array.from(checked).filter(([,input])=>input.checked).map(([name])=>name),folderDecisions:Array.from(decisions,([folder,action])=>({folder,action}))});
    output.replaceChildren();const proposals=result.proposals;
    let first=c.filedCount(proposals.filedCheck.wrong,proposals.filedCheck.checked);
    if(proposals.raise)first+=' '+c.raiseSentence(proposals.raise.threshold,proposals.raise.correctSentToReview);
    else if(proposals.filedCheck.status==='cannot_separate')first+=' '+c.cannotSeparate;
    output.append(el('p',first));
    if(proposals.lower)output.append(el('p',c.lowerSentence(proposals.lower.threshold,proposals.lower.additionalAutomaticLabels,proposals.lower.observedErrors)));
    output.append(el('p',c.correctionSummary(proposals.newTypes.length,proposals.unmatched.length,result.diff.deleted.length)));
    output.append(table([c.source,c.from,c.to],proposals.moves.map(move=>[move.entry.originalFilename,move.from,move.to])));
    for(const proposal of [proposals.raise,proposals.lower])if(proposal)output.append(button(c.apply+': '+proposal.threshold,async()=>{
      await api('/api/runs/'+encodeURIComponent(run.value)+'/corrections/'+encodeURIComponent(result.correctionId)+'/apply',{direction:proposal.direction,threshold:proposal.threshold});await render();
    }));
    for(const folder of proposals.unresolvedFolders){const label=el('label',folder+' ? '+c.unknownFolder);const choice=el('select');choice.id=crypto.randomUUID();label.htmlFor=choice.id;for(const [value,text]of [['',c.chooseDecision],['new_type',c.newType],['ignore',c.ignoreFolder]]){const option=el('option',text);option.value=value;choice.append(option);}choice.onchange=()=>{if(choice.value)decisions.set(folder,choice.value as FolderDecision['action']);else decisions.delete(folder);};output.append(label,choice);}
    if(proposals.unresolvedFolders.length)output.append(button(c.analyze,submitCorrection));
    output.append(technical(result));
  }
  const analyze=button(c.analyze,submitCorrection,true);box.append(choices,folders,analyze,output);main.append(box);
}
async function healthPage(main:HTMLElement):Promise<void>{intro(main,c.health);if(!health)return;main.append(el('span',health.status,'badge'));blockers(main);const box=section(c.versions);box.append(el('p',health.modelCallsEnabled?c.callsEnabled:c.callsDisabled),el('p',`${c.heldRuns}: ${health.textHeldRuns}`),technical(health.versions),technical(health.project));main.append(box);const project=await api('/api/project');main.append(technical(project,c.project));}
function help(main:HTMLElement):void{intro(main,c.helpTitle);for(const [title,body] of c.helpSteps)main.append(section(title,body));const wrong=section(c.wrongTitle);wrong.append(table([c.status,c.details],c.wrongRows.map(row=>[...row])));main.append(wrong);const faq=section(c.faqTitle);for(const [q,a]of c.faq){const d=el('details');d.append(el('summary',q),el('p',a));faq.append(d);}main.append(faq);}
async function render():Promise<void>{const generation=++renderId;if(poll)clearTimeout(poll);const [requested,run]=location.hash.slice(1).split('/');page=Object.hasOwn(c.nav,requested)?requested as Page:decodeURIComponent(location.pathname).endsWith('How It Works.html')?'help':location.pathname.replace(/\/$/,'')==='/health'?'health':'home';activeRun=run?decodeURIComponent(run):'';root.replaceChildren();const skip=el('a',c.skip,'skip');skip.href='#content';root.append(skip);const header=el('header');const bar=el('div',undefined,'bar');bar.append(el('div',c.product,'brand'));const nav=el('nav');for(const [key,label]of Object.entries(c.nav)){const link=el('a',label);link.href=`#${key}`;if(key===page)link.setAttribute('aria-current','page');nav.append(link);}bar.append(nav,button(c.theme,()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localStorage.setItem('theme',next);}));header.append(bar);const main=el('main');main.id='content';main.setAttribute('aria-live','polite');root.append(header,main);try{health=await api<Health>('/api/health');if(generation!==renderId)return;if(health.project?.productName){configureProjectCopy(health.project);document.title=c.product;const brand=header.querySelector('.brand');if(brand)brand.textContent=c.product;for(const link of nav.querySelectorAll('a')){const key=link.hash.slice(1) as Page;link.textContent=c.nav[key];}}if(page==='home')await home(main);else if(page==='runs')await runs(main,generation);else if(page==='build')await build(main);else if(page==='correct')await correct(main);else if(page==='health')await healthPage(main);else help(main);}catch(error){if(generation===renderId){if(page==='build')await build(main);else if(page==='correct')await correct(main);else if(page==='help')help(main);else if(page==='home')await home(main);showError(error);}}}
document.documentElement.dataset.theme=localStorage.getItem('theme')??(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');window.addEventListener('hashchange',()=>void render());void render();


