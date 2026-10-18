import test from 'node:test';
import assert from 'node:assert/strict';
import { readProfileRecord, saveProfileRecord } from '../src/lib/profileRecord.js';
import { workerProfileChange, employerProfileChange } from '../src/lib/profileInput.js';
import { profileFixture } from './fixtures/profile-client.mjs';

test('read failure and not-loaded records never authorize a write',async()=>{
 const f=profileFixture({readError:true});
 await assert.rejects(readProfileRecord(f.client,'worker_profiles'),{code:'PROFILE_READ'});
 for(const record of [null,{status:'error'},{status:'loading'}]) await assert.rejects(saveProfileRecord(f.client,record,{nickname:'bad'}),{code:'PROFILE_NOT_LOADED'});
 assert.equal(f.state.writes,0);
});
for(const table of ['worker_profiles','employer_profiles','emergency_contacts']) {
 test(`${table}: same-column conflict preserves first writer`,async()=>{
  const f=profileFixture(),key=table==='emergency_contacts'?'name':'nickname';
  const a=await readProfileRecord(f.client,table),b=await readProfileRecord(f.client,table);
  await saveProfileRecord(f.client,a,{[key]:'A'});
  await assert.rejects(saveProfileRecord(f.client,b,{[key]:'B'}),{code:'PROFILE_CONFLICT'});
  assert.equal(f.state.rows[table][key],'A');
 });
 test(`${table}: lost response is reconciled without a second write`,async()=>{
  const f=profileFixture({lostResponse:true}),key=table==='emergency_contacts'?'name':'nickname';
  const r=await readProfileRecord(f.client,table);
  assert.equal((await saveProfileRecord(f.client,r,{[key]:'new'})).row[key],'new');assert.equal(f.state.writes,1);
 });
}
test('two editors updating disjoint fields retain both changes',async()=>{
 const f=profileFixture(),a=await readProfileRecord(f.client,'worker_profiles'),b=await readProfileRecord(f.client,'worker_profiles');
 await Promise.all([saveProfileRecord(f.client,a,{transport:'車'}),saveProfileRecord(f.client,b,{residence_city:'徳島市'})]);
 assert.equal(f.state.rows.worker_profiles.transport,'車');assert.equal(f.state.rows.worker_profiles.residence_city,'徳島市');
});
test('compare and write remains guarded when another editor changes the row during the request',async()=>{
 const f=profileFixture({beforeWrite:s=>{s.rows.worker_profiles.transport='バイク';}}),r=await readProfileRecord(f.client,'worker_profiles');
 await assert.rejects(saveProfileRecord(f.client,r,{transport:'車'}),{code:'PROFILE_CONFLICT'});
 assert.equal(f.state.rows.worker_profiles.transport,'バイク');
});
test('JSON fields compare the full prior value including escaped strings',async()=>{
 const f=profileFixture();f.state.rows.worker_profiles.interests=['a,"b','c\\d'];
 const r=await readProfileRecord(f.client,'worker_profiles');
 await saveProfileRecord(f.client,r,{interests:['new']});
 await assert.rejects(saveProfileRecord(f.client,r,{interests:[]}),{code:'PROFILE_CONFLICT'});
});
test('database rejection and failed reconciliation preserve the original record',async()=>{
 const f=profileFixture({dbError:true}),r=await readProfileRecord(f.client,'worker_profiles');
 await assert.rejects(saveProfileRecord(f.client,r,{transport:'車'}),{code:'PROFILE_SAVE'});
 assert.equal(f.state.rows.worker_profiles.transport,'自転車');
 f.state.options.dbError=false;f.state.options.lostResponse=true;f.state.options.readErrorAfterWrite=true;
 await assert.rejects(saveProfileRecord(f.client,r,{transport:'車'}),{code:'PROFILE_UNCONFIRMED'});
 assert.equal(f.state.rows.worker_profiles.transport,'車');assert.equal(r.row.transport,'自転車');
});
test('missing row uses insert and never overwrites a concurrently created profile',async()=>{
 const f=profileFixture();delete f.state.rows.worker_profiles;
 const a=await readProfileRecord(f.client,'worker_profiles'),b=await readProfileRecord(f.client,'worker_profiles');
 await saveProfileRecord(f.client,a,{nickname:'A'});
 await assert.rejects(saveProfileRecord(f.client,b,{nickname:'B'}),{code:'PROFILE_CONFLICT'});
 assert.equal(f.state.rows.worker_profiles.nickname,'A');
});
test('account switch and signed-out session cannot save the old owner record',async()=>{
 const f=profileFixture(),r=await readProfileRecord(f.client,'worker_profiles');
 for(const id of [null,'different-user']) {f.state.userId=id;await assert.rejects(saveProfileRecord(f.client,r,{nickname:'bad'}),{code:'PROFILE_SESSION'});}
 assert.equal(f.state.writes,0);
});
test('account switch while saving never exposes the old owner result to the new screen',async()=>{
 const f=profileFixture({beforeWrite:s=>{s.userId='different-user';}}),r=await readProfileRecord(f.client,'worker_profiles');
 await assert.rejects(saveProfileRecord(f.client,r,{nickname:'new'}),{code:'PROFILE_SESSION'});
});
test('account switch after the client check but before RPC execution cannot write',async()=>{
 const f=profileFixture({beforeRPC:s=>{s.userId='different-user';}}),r=await readProfileRecord(f.client,'worker_profiles');
 await assert.rejects(saveProfileRecord(f.client,r,{nickname:'input from prior account'}));
 assert.equal(f.state.writes,0);assert.equal(f.state.rows.worker_profiles.nickname,r.row.nickname);
});
test('worker section saves exclude unrelated profile and pending text fields',async()=>{
 const change=workerProfileChange('residence',{residence_city:'徳島市',transport:'old',pr:'old'},{});
 assert.deepEqual(change.patch,{residence_city:'徳島市'});
 const f=profileFixture(),r=await readProfileRecord(f.client,'worker_profiles');
 const pr=workerProfileChange('pr',{pr:'新しい自己紹介'},r.row);
 const saved=await saveProfileRecord(f.client,r,pr.patch,pr.options);
 assert.equal(saved.row.pr,'新しい自己紹介');assert.deepEqual(saved.row.pr_qa,r.row.pr_qa);
});
test('employer text results are checked after publication and do not replace other sections',async()=>{
 const f=profileFixture(),r=await readProfileRecord(f.client,'employer_profiles');
 const texts={unique_point:'新しい特徴',always_do:'',break_style:''};
 const c=employerProfileChange('ask',{},texts,'employer_profiles',r.row);
 assert.deepEqual(Object.keys(c.patch),['texts_pending']);
 const result=await saveProfileRecord(f.client,r,c.patch,c.options);
 assert.equal(result.row.unique_point,'新しい特徴');assert.equal(result.row.owner_comment,'元の代表文');
 assert.deepEqual(result.row.texts_pending,{});
});
test('confirmed timestamp tolerates PostgreSQL timezone representation',async()=>{
 const f=profileFixture({normalizeTimestamp:true}),r=await readProfileRecord(f.client,'emergency_contacts');
 const result=await saveProfileRecord(f.client,r,{name:'本人',confirmed_at:'2026-10-18T15:00:00.000Z'});
 assert.equal(result.row.name,'本人');assert.equal(f.state.writes,1);
});
test('no-op text save does not repeat side effects, but detects intervening edits',async()=>{
 const f=profileFixture(),r=await readProfileRecord(f.client,'worker_profiles');
 const c=workerProfileChange('pr',{pr:r.row.pr},r.row);
 await saveProfileRecord(f.client,r,c.patch,c.options);assert.equal(f.state.writes,0);
 f.state.rows.worker_profiles.pr='changed';
 await assert.rejects(saveProfileRecord(f.client,r,c.patch,c.options),{code:'PROFILE_CONFLICT'});
});
