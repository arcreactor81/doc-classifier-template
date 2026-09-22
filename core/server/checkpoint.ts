import { ServerFailure, failure } from './errors.ts';
export interface CheckpointStore {
  claim(name: string): Promise<{ state: 'claimed' | 'uncertain' } | { state:'failed';error:{code:string;kind:'blocker'|'document'|'request';message:string} } | { state: 'complete'; key: string }>;
  finish(name: string, key: string): Promise<void>;
  fail(name: string, error:{code:string;kind:'blocker'|'document'|'request';message:string}): Promise<void>;
}
export async function checkpoint(store: CheckpointStore, guard: () => Promise<void>, name: string, work: () => Promise<string>): Promise<string> {
  await guard();
  const claim = await store.claim(name);
  if (claim.state === 'complete') return claim.key;
  if (claim.state === 'uncertain') throw new ServerFailure('E_STEP_UNCERTAIN', 'blocker', 'A stage was interrupted before its result was recorded. It will not be repeated automatically.');
  if (claim.state === 'failed') throw new ServerFailure(claim.error.code,claim.error.kind,claim.error.message);
  try {
    const key = await work();
    await store.finish(name, key);
    return key;
  } catch (error) {
    const issue=failure(error); await store.fail(name, {code:issue.code,kind:issue.kind,message:issue.message});
    throw error;
  }
}