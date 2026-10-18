import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const sql=await readFile(new URL('../supabase/migrations/20261018140713_profile_section_compare_and_save.sql',import.meta.url),'utf8');

test('actual profile RPC enforces atomic comparisons, RLS and publication triggers',async t=>{
 const db=new PGlite();
 try {
  await db.exec(await readFile(new URL('./fixtures/profile-schema.sql',import.meta.url),'utf8'));
  await db.exec(sql);
  const login=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+role);};
  const call=async(table,expected,patch)=>(await db.query('select public.save_my_profile_fields($1,$2::jsonb,$3::jsonb) as result',[table,expected===null?null:JSON.stringify(expected),JSON.stringify(patch)])).rows[0].result;
  await login(owner);
  await t.test('initial insert preserves defaults and a second insert conflicts',async()=>{
   const r=await call('worker_profiles',null,{nickname:'first',transport:'自転車',interests:['A','B']});
   assert.equal(r.ok,true);assert.equal(r.row.auth_id,owner);assert.deepEqual(r.row.self_declared,[]);
   assert.equal((await call('worker_profiles',null,{nickname:'second'})).reason,'conflict');
  });
  await t.test('different fields keep both changes while stale same-field saves fail',async()=>{
   assert.equal((await call('worker_profiles',{transport:'自転車'},{transport:'車'})).ok,true);
   assert.equal((await call('worker_profiles',{nickname:'first'},{nickname:'new'})).ok,true);
   assert.equal((await call('worker_profiles',{transport:'自転車'},{transport:'バイク'})).reason,'conflict');
   const row=(await db.query('select * from worker_profiles')).rows[0];assert.equal(row.transport,'車');assert.equal(row.nickname,'new');
  });
  await t.test('arrays require exact equality, not containment',async()=>{
   assert.equal((await call('worker_profiles',{interests:['A']},{interests:[]})).reason,'conflict');
   assert.equal((await call('worker_profiles',{interests:['B','A']},{interests:[]})).reason,'conflict');
   assert.equal((await call('worker_profiles',{interests:['A','B']},{interests:['C']})).ok,true);
  });
  await t.test('full long text comparison succeeds without timestamps as the comparison token',async()=>{
   const text='長い入力'.repeat(4000);
   assert.equal((await call('worker_profiles',{pr:null,pr_pending:null},{pr_pending:text})).ok,true);
   assert.equal((await call('worker_profiles',{pr:text,pr_pending:null},{pr_pending:'変更後'})).ok,true);
  });
  await t.test('worker publication and existing validation remain atomic',async()=>{
   const r=await call('worker_profiles',{pr:'変更後',pr_pending:null},{pr_pending:'公開する本文'});
   assert.equal(r.row.pr,'公開する本文');assert.equal(r.row.pr_pending,null);
   await assert.rejects(call('worker_profiles',{pr:'公開する本文',pr_pending:null},{pr_pending:'[blocked]'}),/blocked/);
   assert.equal((await db.query('select pr from worker_profiles')).rows[0].pr,'公開する本文');
  });
  await t.test('employer text folding returns canonical values and keeps unrelated text',async()=>{
   assert.equal((await call('employer_profiles',null,{nickname:'農園',texts_pending:{owner_comment:'代表文'}})).ok,true);
   const r=await call('employer_profiles',{unique_point:null,texts_pending:{}},{texts_pending:{unique_point:'特徴'}});
   assert.equal(r.row.unique_point,'特徴');assert.equal(r.row.owner_comment,'代表文');assert.deepEqual(r.row.texts_pending,{});
  });
  await t.test('invalid tables, columns, missing comparison fields and oversized input are rejected',async()=>{
   assert.equal((await call('account_holders',null,{nickname:'bad'})).reason,'invalid_table');
   assert.equal((await call('worker_profiles',null,{auth_id:other})).reason,'invalid_fields');
   assert.equal((await call('worker_profiles',{}, {nickname:'bad'})).reason,'invalid_expected');
   assert.equal((await call('worker_profiles',{transport:'車'}, {nickname:'bad'})).reason,'invalid_fields');
   assert.equal((await call('worker_profiles',{nickname:'new'}, {nickname:'x'.repeat(262145)})).reason,'invalid_patch');
  });
  await t.test('another authenticated user cannot select or overwrite the owner',async()=>{
   await login(other);assert.equal((await db.query('select * from worker_profiles')).rows.length,0);
   assert.equal((await call('worker_profiles',{nickname:'new'},{nickname:'intruder'})).reason,'conflict');
   await login(owner);assert.equal((await db.query('select nickname from worker_profiles')).rows[0].nickname,'new');
  });
  await t.test('invoker keeps the consignment policy restriction',async()=>{
   await assert.rejects(call('consignment_profiles',null,{nickname:'bad'}),/row-level security/);
  });
  await t.test('emergency contact confirmation is saved with the edited fields',async()=>{
   const r=await call('emergency_contacts',null,{name:'本人',relation:'本人',phone:'000',confirmed_at:'2026-10-18T14:00:00Z'});
   assert.equal(r.ok,true);assert.ok(r.row.confirmed_at);
   assert.equal((await call('emergency_contacts',{name:'古い名前'},{name:'bad'})).reason,'conflict');
  });
  await t.test('anonymous execute is denied and an authenticated role without a user cannot write',async()=>{
   await login(null);assert.equal((await call('worker_profiles',null,{nickname:'bad'})).reason,'not_logged_in');
   await login(null,'anon');await assert.rejects(call('worker_profiles',null,{nickname:'bad'}),/permission denied/);
  });
  await db.exec('reset role');
  const flags=(await db.query("select prosecdef,proconfig from pg_proc where proname='save_my_profile_fields'")).rows[0];
  assert.equal(flags.prosecdef,false);assert.ok(flags.proconfig.some(x=>x.startsWith('search_path=')));
 } finally {await db.close();}
});
