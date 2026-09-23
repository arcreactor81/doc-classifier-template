import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseWranglerConfig} from './deploy-cloud.mjs';
test('fresh deployment never asks for authentication identifiers or inserts the Static Assets router',()=>{
 const config=parseWranglerConfig(readFileSync('wrangler.template.jsonc','utf8'));
 const pkg=JSON.parse(readFileSync('package.json','utf8'));
 assert.equal(config.main,'core/server/managed-worker.ts');
 assert.equal(config.assets,undefined);
 assert.equal(config.vars.MODEL_CALLS_ENABLED,'false');
 for(const name of ['ACCESS_AUD','ACCESS_TEAM_DOMAIN']){assert.equal(config.vars[name],undefined);assert.equal(pkg.cloudflare.bindings[name],undefined);}
 assert.equal(config.alias['bundled-ui'],'./.wrangler/bundled-ui/worker-assets.mjs');
 assert.ok(config.rules.some(rule=>rule.type==='Text'&&rule.globs.includes('**/worker-ui/*.txt')));
});
