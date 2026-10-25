import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {captureContract,renderMatrix} from './authorization/catalog.mjs';
import {root,s} from './authorization/database.mjs';

test('all database and source operations match the reviewed authorization contract',async()=>{
 const expected=JSON.parse(await readFile(new URL('security/authorization-contract.json',root),'utf8'));
 const actual=await captureContract();
 assert.deepEqual(actual,expected,'Authorization changed. Review the policy, add behavioral tests, then explicitly regenerate with npm run authorization:matrix.');
 assert.equal(await readFile(new URL('security/authorization-matrix.md',root),'utf8'),renderMatrix(actual),'Human-readable matrix is stale');
 assert.equal(new Set(actual.database.map(r=>r.id)).size,actual.database.length,'duplicate operation');
 for(const row of actual.database.filter(r=>r.kind==='table'))assert.equal(row.rls,true,row.resource+' needs RLS');
 for(const row of actual.database.filter(r=>r.policies))for(const p of row.policies){
  assert.doesNotMatch((p.qual||'')+(p.with_check||''),/t5fki6643qty|user_metadata/,'legacy admin bypass: '+row.id);
 }
});

test('the baseline migrations are immutable; new migrations must replay in the contract fixture',async()=>{
 for(const [file,expected] of Object.entries(s.baselineMigrations)){
  const bytes=await readFile(new URL('supabase/migrations/'+file,root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expected,file);
 }
});

test('schema fixture contains no production rows or mail credentials',async()=>{
 const fixture=await readFile(new URL('scripts/fixtures/authorization/schema.json',root),'utf8');
 assert.ok(!/(?<![A-Za-z0-9_])(?:xkeysib-[A-Za-z0-9-]{20,}|re_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/.test(fixture),'fixture must not contain credential literals');
 for(const f of s.functions.filter(f=>['send_user_email','send_admin_email','chat_message_mail_send'].includes(f.name)))assert.equal(f.testStub,true);
});
