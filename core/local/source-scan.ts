import { scanSourceFolder, type LocalDirectoryHandle } from '../builder/browser.ts';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const summaryName = new RegExp(`^build-summary-${uuid}\\.md$`, 'i');
const summaryHeader = new RegExp(`^# Local build summary\\n\\nRun: (${uuid})(?:\\n|$)`, 'i');
export interface GeneratedTree { path: string; runId: string; summaryPath: string }
interface ScanOptions { signal?: AbortSignal; onProgress?: (filesHashed: number, path: string) => void }
function checkSignal(signal?: AbortSignal) { if(signal?.aborted) throw new DOMException('E_LOCAL_SCAN_CANCELLED','AbortError'); }

/** Read-only discovery; names alone never identify generated trees. Discovery does not exclude anything. */
export async function discoverGeneratedTrees(root: LocalDirectoryHandle, options: Pick<ScanOptions,'signal'> = {}): Promise<GeneratedTree[]> {
  const found: GeneratedTree[] = [];
  async function visit(directory: LocalDirectoryHandle, prefix: string) {
    checkSignal(options.signal);
    for await(const handle of directory.values()) {
      checkSignal(options.signal);
      const path=prefix ? `${prefix}/${handle.name}` : handle.name;
      if(handle.kind==='directory') await visit(handle,path);
      else if(summaryName.test(handle.name)) {
        const header=await (await handle.getFile()).slice(0,256).text();
        const match=summaryHeader.exec(header);
        if(match) found.push({path:prefix,runId:match[1],summaryPath:path});
      }
    }
  }
  await visit(root,'');
  return found;
}

/** All files are included unless the user explicitly excluded an identified generated tree. */
export async function scanExtractionSource(root: LocalDirectoryHandle, options: ScanOptions & {excludedGeneratedTrees?: readonly string[]} = {}) {
  const excluded=new Set(options.excludedGeneratedTrees ?? []);
  if(excluded.size===0) return scanSourceFolder(root,options);
  const detected=new Set((await discoverGeneratedTrees(root,options)).map(tree=>tree.path));
  for(const path of excluded) if(!path || !detected.has(path)) throw new Error('E_LOCAL_GENERATED_TREE_SELECTION');
  function filtered(directory: LocalDirectoryHandle,prefix: string): LocalDirectoryHandle {
    return {kind:'directory',name:directory.name,
      getDirectoryHandle:directory.getDirectoryHandle.bind(directory),getFileHandle:directory.getFileHandle.bind(directory),
      async *values(){
        for await(const handle of directory.values()){
          checkSignal(options.signal);
          const path=prefix ? `${prefix}/${handle.name}` : handle.name;
          if(handle.kind==='directory') { if(!excluded.has(path)) yield filtered(handle,path); }
          else yield handle;
        }
      }
    };
  }
  return scanSourceFolder(filtered(root,''),options);
}
