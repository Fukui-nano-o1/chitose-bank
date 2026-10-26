import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const root=new URL('../',import.meta.url);
const files=await readdir(new URL('supabase/migrations/',root));
const migration=await readFile(new URL('supabase/migrations/'+files.find(f=>f.endsWith('_secure_app_error_ingestion.sql')),root),'utf8');
const member='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002', admin='00000000-0000-4000-8000-000000000003';

test('error ingestion derives identity, protects operator state, and preserves reporting',async t=>{
 const db=new PGlite();
 const login=async(uid=null,isAdmin=false)=>{
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(uid?{sub:uid,role:'authenticated',email:isAdmin?'t5fki6643qty@gmail.com':'member@example.invalid'}:{role:'anon'})]);
  await db.exec('set role '+(uid?'authenticated':'anon'));
 };
 const inspect=async(session)=>{await db.exec('reset role');return(await db.query('select * from app_errors where session_id=$1',[session])).rows;};
 const notify=async(component)=>{await db.exec('reset role');return(await db.query('select body from admin_messages where body like $1',['%'+component+'%'])).rows;};
 const insert=async(session,fields={})=>{
  const row={session_id:session,message:'Synthetic error',component:session,source:'client',...fields};
  const keys=Object.keys(row); // Only literals defined by this test, never external input.
  await db.query(`insert into app_errors(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
 };
 try{
  await db.exec(await readFile(new URL('scripts/fixtures/app-error-schema.sql',root),'utf8'));
  await db.query('insert into auth.users values($1,$2)',[admin,'t5fki6643qty@gmail.com']);
  for(const name of ['20260928095153_app_errors_rate_limit.sql','20261002153325_distinguish_googlebot_error_reports.sql'])
   await db.exec(await readFile(new URL('supabase/migrations/'+name,root),'utf8'));
  await db.exec('create trigger trg_z_app_error_report after insert on app_errors for each row execute function app_error_report_to_admin()');
  await login();await insert('legacy',{user_id:other,status:'fixed',admin_note:'forged'});
  assert.equal((await inspect('legacy'))[0].user_id,other,'reproduce the pre-fix anonymous impersonation');
  await db.exec(migration);

  await t.test('historical rows stay unverified and are not silently rewritten',async()=>{
   const row=(await inspect('legacy'))[0];
   assert.equal(row.identity_verified,false);assert.equal(row.user_id,other);assert.equal(row.admin_note,'forged');
  });
  for(const [name,uid] of [['anonymous',null],['member',member],['admin',admin]]) await t.test(name+' normal reports still reach the operator',async()=>{
   await login(uid,uid===admin);await insert('normal-'+name);
   const row=(await inspect('normal-'+name))[0];
   assert.equal(row.user_id,uid);assert.equal(row.identity_verified,true);assert.equal(row.status,'open');
   const notices=await notify('normal-'+name);assert.equal(notices.length,1);
   assert.ok(notices[0].body.includes(uid?'ログイン中（認証確認済み）':'利用者：未ログイン'));
  });
  for(const [name,uid] of [['anonymous',null],['member',member],['admin',admin]]) await t.test(name+' cannot choose the initial trusted fields, including old-client payloads',async()=>{
   await login(uid,uid===admin);
   await insert('forged-'+name,{user_id:other,status:'fixed',admin_note:'forged',resolved_at:'2000-01-01',created_at:'2000-01-01',identity_verified:false,user_agent:'Googlebot/2.1'});
   const row=(await inspect('forged-'+name))[0];
   assert.equal(row.user_id,uid);assert.equal(row.identity_verified,true);assert.equal(row.status,'open');
   assert.equal(row.admin_note,null);assert.equal(row.resolved_at,null);assert.ok(new Date(row.created_at)>new Date('2026-01-01'));
   const notices=await notify('forged-'+name);assert.equal(notices.length,1);
   assert.match(notices[0].body,/Googlebot申告・未検証/);
   assert.ok(notices[0].body.includes(uid?'ログイン中（認証確認済み）':'利用者：未ログイン'));
   assert.doesNotMatch(notices[0].body,/自動巡回（Googlebot）/);
  });
  await t.test('members and guests cannot read or resolve reports; upsert cannot alter an existing report',async()=>{
   const id=(await inspect('normal-member'))[0].id;
   for(const uid of [null,member]){
    await login(uid);
    assert.equal((await db.query('select count(*)::int n from app_errors')).rows[0].n,0);
    assert.equal((await db.query("update app_errors set status='fixed',admin_note='forged' where id=$1 returning id",[id])).rows.length,0);
    await assert.rejects(db.query("insert into app_errors(id,message) values($1,'upsert') on conflict(id) do update set status='fixed'",[id]),/row-level security/);
   }
   assert.equal((await inspect('normal-member'))[0].status,'open');
  });
  await t.test('the operator can still resolve a report without changing its verified author',async()=>{
   const id=(await inspect('normal-member'))[0].id;
   await login(admin,true);
   const row=(await db.query("update app_errors set status='fixed',admin_note='checked',resolved_at=now() where id=$1 returning *",[id])).rows[0];
   assert.equal(row.status,'fixed');assert.equal(row.admin_note,'checked');assert.ok(row.resolved_at);
   assert.equal(row.user_id,member);assert.equal(row.identity_verified,true);
  });
  await t.test('backdated batches do not bypass the existing per-session rate limit',async()=>{
   await login();
   for(let i=0;i<21;i++) await insert('rate-window',{created_at:'2000-01-01',message:'loading chunk synthetic-rate-check'});
   assert.equal((await inspect('rate-window')).length,20);
  });
  await t.test('a claimed crawler cannot suppress the corresponding ordinary visitor notification',async()=>{
   await login();await insert('separate-claim',{user_agent:'Googlebot/2.1'});
   await insert('separate-claim',{user_agent:'Mozilla/5.0'});
   assert.equal((await notify('separate-claim')).length,2);
  });
  await t.test('normalizer remains invoker-only and inaccessible as a public RPC',async()=>{
   await db.exec('reset role');
   const row=(await db.query("select p.prosecdef,has_function_privilege('anon',p.oid,'execute') a,has_function_privilege('authenticated',p.oid,'execute') m from pg_proc p where p.oid='private.normalize_app_error_insert()'::regprocedure")).rows[0];
   assert.deepEqual(row,{prosecdef:false,a:false,m:false});
  });
 }finally{await db.close();}
});

test('revised error-record disclosure and database consent use the same version',async()=>{
 const db=new PGlite();
 try{
  await db.exec(await readFile(new URL('scripts/fixtures/app-error-schema.sql',root),'utf8'));
  await db.exec(`create table public.app_settings(key text primary key,value text,updated_at timestamptz);
   insert into public.app_settings values('privacy_version','v4.8-2026-09',now());
   create table public.account_holders(auth_id uuid primary key,agreed_privacy_version text);
   grant select,update on public.account_holders to authenticated;
   alter table public.account_holders enable row level security;
   create policy own on public.account_holders to authenticated using(auth_id=auth.uid()) with check(auth_id=auth.uid());`);
  await db.query('insert into account_holders values($1,$2)',[member,'v4.8-2026-09']);
  const existing=await readFile(new URL('supabase/migrations/20260919114602_resumable_job_drafts.sql',root),'utf8');
  await db.exec(existing.slice(0,existing.indexOf('\n\n')));
  await db.exec(existing.slice(existing.indexOf('create or replace function public.save_my_privacy_consent')));
  await db.exec(await readFile(new URL('supabase/migrations/'+files.find(f=>f.endsWith('_error_report_privacy_version.sql')),root),'utf8'));
  const source=await readFile(new URL('src/lib/utils.js',root),'utf8');
  const version=source.match(/export const PRIVACY_VERSION = "([^"]+)"/)[1];
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:member,role:'authenticated'})]);
  await db.exec('set role authenticated');
  assert.equal((await db.query('select current_privacy_version() version')).rows[0].version,version);
  await assert.rejects(db.query('select save_my_privacy_consent($1,$2)',[member,'v4.8-2026-09']),/POLICY_CHANGED/);
  const row=(await db.query('select save_my_privacy_consent($1,$2) result',[member,version])).rows[0];
  assert.equal(row.result.agreed_privacy_version,version);
  await assert.rejects(db.query('select save_my_privacy_consent($1,$2)',[other,version]),/AUTH_REQUIRED/);
 }finally{await db.close();}
});
