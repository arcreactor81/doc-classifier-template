import { spawnSync } from 'node:child_process';
const commands=[['node_modules/typescript/bin/tsc','--noEmit'],['node_modules/typescript/bin/tsc','-p','tsconfig.worker.json','--noEmit'],['--test','--test-reporter=spec','core/**/*.test.ts','scripts/*.test.mjs'],['node_modules/vite/bin/vite.js','build']];
for(const args of commands){const run=spawnSync(process.execPath,args,{stdio:'inherit'});if(run.error)throw run.error;if(run.status!==0)process.exit(run.status??1);}
