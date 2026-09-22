import test from 'node:test';
import assert from 'node:assert/strict';
import {presentRunDocuments} from './run-results.ts';
const doc=(ruleId:string,reasonCode:string,extra={})=>({original_filename:ruleId+'.pdf',status:'complete',decision:{ruleId,reasonCode,destinationFolder:ruleId==='R1'?'type_a':'human_review',failures:[],notes:[]},failure_json:null,...extra});
test('actual run API decisions show outcomes and reasons, only R1 is filed',()=>{
 const rows=presentRunDocuments([doc('R1','agreement_at_threshold'),doc('R2','low_certainty'),doc('R3','straddles_types'),doc('R4','possible_new_type'),doc('R0n','document_notes')]);
 assert.equal(rows[0].outcome,'Filed');assert.equal(rows[0].tone,'filed');
 for(const row of rows.slice(1)){assert.equal(row.outcome,'Review');assert.equal(row.tone,'review');assert.ok(row.reason.length>0);}
 assert.equal(rows[0].filename,'R1.pdf');assert.equal(rows[0].destination,'type_a');
});
test('R5 sorts first stably without mutating API rows and carries visible review priority',()=>{
 const input=[doc('R2','low_certainty',{fingerprint:'second'}),doc('R5','systems_disagree',{fingerprint:'first'}),doc('R1','agreement_at_threshold'),doc('R5','systems_disagree',{original_filename:'second'})];
 const rows=presentRunDocuments(input);assert.deepEqual(rows.map(r=>r.filename),['R5.pdf','second','R2.pdf','R1.pdf']);assert.equal(input[0].original_filename,'R2.pdf');assert.equal(rows[0].priority,'Review first');assert.equal(rows[0].tone,'review');assert.equal(rows[0].fingerprint,'first');assert.equal(rows[2].fingerprint,'second');
});
test('failures expose actual failure details and unfinished documents never claim an outcome',()=>{
 const [failed,pending,malformed]=presentRunDocuments([doc('R0','stage_failed',{failure_json:JSON.stringify({code:'E_READER_SCHEMA',message:'Evidence was not verbatim.'})}),{original_filename:'pending',status:'running',decision:null},{original_filename:'broken',status:'complete',decision:null,failure_json:'{'}]);
 assert.equal(failed.outcome,'Could not process');assert.equal(failed.tone,'failed');assert.match(failed.reason,/Evidence was not verbatim/);assert.match(failed.reason,/E_READER_SCHEMA/);
 assert.equal(pending.tone,'');assert.equal(pending.outcome,'Processing');assert.equal(malformed.outcome,'Outcome unavailable');
});
