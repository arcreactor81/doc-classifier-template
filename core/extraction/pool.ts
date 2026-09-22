import type { ExtractOptions, ExtractedDocument } from './extract.ts';
export interface WorkerResult { id: number; document?: ExtractedDocument; failure?: { code: string; message: string } }
interface Task { id: number; file: File; resolve: (document: ExtractedDocument) => void; reject: (error: Error) => void }
/** Fixed local parallelism; closing or a worker crash explicitly rejects affected work. */
export class ExtractionPool {
  readonly options: ExtractOptions;
  private slots: { worker: Worker; task?: Task }[] = [];
  private queue: Task[] = [];
  private nextId = 0;
  private closed = false;
  constructor(size: number, options: ExtractOptions) {
    if (!Number.isSafeInteger(size) || size < 1) throw new Error('Extraction worker count must be a positive integer.');
    this.options = options;
    for (let index = 0; index < size; index++) {
      const slot: { worker: Worker; task?: Task } = { worker: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) };
      slot.worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        const task = slot.task;
        if (!task || event.data.id !== task.id) { this.close(new Error('The extraction worker returned an unexpected result.')); return; }
        slot.task = undefined;
        if (event.data.failure) {
          const failure = new Error(event.data.failure.message);
          Object.assign(failure, { code: event.data.failure.code });
          task.reject(failure);
        } else if (event.data.document) task.resolve(event.data.document);
        else task.reject(new Error('The extraction worker returned no document or failure.'));
        this.dispatch();
      };
      slot.worker.onerror = event => { event.preventDefault(); this.close(new Error(event.message || 'The extraction worker stopped unexpectedly.')); };
      slot.worker.onmessageerror = () => this.close(new Error('An extraction worker message could not be read.'));
      this.slots.push(slot);
    }
  }
  extract(file: File): Promise<ExtractedDocument> {
    if (this.closed) return Promise.reject(new Error('The extraction pool is closed.'));
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, file, resolve, reject });
      this.dispatch();
    });
  }
  private dispatch(): void {
    for (const slot of this.slots) {
      if (slot.task || !this.queue.length) continue;
      const task = this.queue.shift()!;
      slot.task = task;
      try { slot.worker.postMessage({ id: task.id, file: task.file, options: this.options }); }
      catch (error) { this.close(error instanceof Error ? error : new Error(String(error))); return; }
    }
  }
  close(reason = new Error('Local extraction was stopped.')): void {
    this.closed = true;
    for (const slot of this.slots) { slot.worker.terminate(); slot.task?.reject(reason); slot.task = undefined; }
    for (const task of this.queue) task.reject(reason);
    this.queue = [];
  }
}