import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateReferenceLineage,referenceEntriesFromStored} from './feedback.ts';
test('reference run must pin exact owner accepted definition revision',()=>{
 assert.doesNotThrow(()=>validateReferenceLineage('rev','rev'));
 assert.throws(()=>validateReferenceLineage('rev','other'));
 assert.throws(()=>validateReferenceLineage('rev',undefined));
});
test('stored source correction provides labels without accepting client results',()=>{
 const entry={fingerprint:'one',tag:'t',originalFilename:'file.pdf',destinationFolder:'human_review',rule:'R4'};
 const diff={confirmations:[],moves:[{entry,file:{folder:'New category',filename:'file.pdf'},matchedBy:'tag' as const,from:'human_review',to:'New category',kind:'unresolved_folder' as const}],unchecked:[],deleted:[],unmatched:[],ignored:[],unknownFolders:[]};
 assert.equal(referenceEntriesFromStored([entry],diff,['new_type'],[],{'New category':'new_type'},[])[0].labels[0],'new_type');
 assert.equal(referenceEntriesFromStored([entry],{...diff,moves:[],unchecked:[diff.moves[0]]},['new_type'],[],{},[])[0].status,'unconfirmed');
});

test('saved references are append-only and owner scoped',async()=>{
 const {saveReference,readReference}=await import('./feedback.ts');
 const writes:{sql:string;values:unknown[]}[]=[];
 const entry={fingerprint:'one',tag:'tag',originalFilename:'source.pdf',destinationFolder:'a',rule:'R1'};
 const diff={confirmations:[{entry,file:{folder:'a',filename:'renamed.pdf'},matchedBy:'tag'}],moves:[],unchecked:[],deleted:[],unmatched:[],ignored:[],unknownFolders:[]};
 const run={id:'source',actor:'owner',status:'closed',expected_count:1,pack_json:JSON.stringify({typeFile:{types:[{id:'a'},{id:'b'}]}})} as import('./store.ts').RunRow;
 let last:Record<string,unknown>|null=null;
 const store={env:{DB:{prepare:(sql:string)=>({bind:(...values:unknown[])=>({first:async()=>sql.includes('definition_revisions')?{type_file_json:JSON.stringify({types:[{id:'a'},{id:'b'}]})}:sql.includes('FROM corrections')?{result_key:'saved'}:last,run:async()=>{writes.push({sql,values});last={id:values[0],source_run_id:values[1],correction_id:values[2],definition_revision_id:values[3],confirmed_by:values[5],labels_json:values[6]};}})})}},documents:async()=>[{fingerprint:'one',tag:'tag',original_filename:'source.pdf',decision_json:JSON.stringify({destinationFolder:'a',ruleId:'R1'})}],json:async()=>({diff,proposals:{ignoredFolders:[]}})} as unknown as import('./store.ts').Store;
 const input={definitionRevisionId:'rev',labels:[{fingerprint:'one',status:'ambiguous' as const,labels:['a','b']}]};
 const first=await saveReference(store,run,'correction','owner',input),second=await saveReference(store,run,'correction','owner',input);
 assert.notEqual(first.id,second.id);assert.equal(writes.length,2);assert.ok(writes.every(write=>write.sql.startsWith('INSERT INTO feedback_references')));
 assert.equal((await readReference(store,second.id,'owner')).entries[0].status,'ambiguous');
 await assert.rejects(()=>readReference(store,second.id,'other'));
 await assert.rejects(()=>saveReference(store,run,'correction','other',input));assert.equal(writes.length,2);
});
