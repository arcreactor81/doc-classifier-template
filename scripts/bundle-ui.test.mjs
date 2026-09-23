import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bundleUi} from './bundle-ui.mjs';
async function fixture(action){const root=await mkdtemp(join(tmpdir(),'classifier-ui-'));const dir=join(root,'dist'),output=join(root,'bundle');try{await mkdir(join(dir,'assets'),{recursive:true});await writeFile(join(dir,'index.html'),'<script src="/assets/app-abcdefgh.js"></script>');return await action(dir,output);}finally{await rm(root,{recursive:true,force:true});}}
test('bundled UI copies exact text and imports deterministic Text modules with safe paths',()=>fixture(async (dir,output)=>{
 const script='// preserve comment\nconst x = "</script>\\n"; /* import stays literal */\n';
 await writeFile(join(dir,'assets','app-abcdefgh.js'),script);await writeFile(join(dir,'assets','font-abcdefgh.css'),'body { color: red; }');
 const result=await bundleUi(dir,output);assert.equal(result.assets,3);const generated=await readFile(result.modulePath,'utf8');
 assert.match(generated,/import asset0 from "\.\/worker-ui\/00000\.txt"/);assert.match(generated,/"\/assets\/app-abcdefgh.js"/);assert.match(generated,/immutable:true/);
 assert.equal(await readFile(join(output,'worker-ui','00000.txt'),'utf8'),script);
 await bundleUi(dir,output);assert.equal(await readFile(result.modulePath,'utf8'),generated);
 await assert.rejects(bundleUi(dir,join(dir,'bundle')),/outside/);
}));
test('bundled UI rejects missing entry, unsupported binary output and malformed UTF-8',()=>fixture(async (dir,output)=>{
 await rm(join(dir,'index.html'));await assert.rejects(bundleUi(dir,output),/index\.html/);await writeFile(join(dir,'index.html'),'ok');
 await writeFile(join(dir,'assets','image.png'),new Uint8Array([137,80,78,71]));await assert.rejects(bundleUi(dir,output),/Unsupported UI asset/);await rm(join(dir,'assets','image.png'));
 await writeFile(join(dir,'assets','broken.js'),new Uint8Array([0xc3,0x28]));await assert.rejects(bundleUi(dir,output),/UTF-8/);
}));
test('bundled UI rejects links and output names requiring unsafe path decoding',()=>fixture(async (dir,output)=>{
 await writeFile(join(dir,'assets','bad%2f.js'),'bad');await assert.rejects(bundleUi(dir,output),/asset path/);await rm(join(dir,'assets','bad%2f.js'));
 // Directory junctions are available on Windows without symbolic-link privilege.
 const outside=await mkdtemp(join(tmpdir(),'classifier-outside-'));try{await symlink(outside,join(dir,'linked'),'junction');await assert.rejects(bundleUi(dir,output),/symbolic link/);}finally{await rm(join(dir,'linked'),{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
}));
