import { defineConfig } from 'vite';
export default defineConfig({
 root:'ui/app',
 build:{outDir:'../../dist',emptyOutDir:true,target:'es2022'},
 worker:{format:'es'},
 server:{host:'127.0.0.1',proxy:{'/api':'http://127.0.0.1:8787'}},
});
