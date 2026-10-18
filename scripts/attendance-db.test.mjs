import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const own='00000000-0000-4000-8000-000000000001',farmer='00000000-0000-4000-8000-000000000002',stranger='00000000-0000-4000-8000-000000000003',app='10000000-0000-4000-8000-000000000001';
const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input={application_id:app,kind:'plan_mismatch',reason:'条件の確認',work_date:'2026-10-18',detail:'pay'};
test('attendance UUID receipt preserves existing RLS and notification triggers',async t=>{
 const db=new PGlite();
 try{
  await db.exec(`set timezone='UTC';create role anon;create role authenticated;create schema auth;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to authenticated;
   create table app_admins(auth_id uuid primary key);grant select on app_admins to authenticated;
   create table applications(id uuid primary key,worker_id uuid,farmer_id uuid,job_number integer);
   insert into applications values('${app}','${own}','${farmer}',17);
   alter table applications enable row level security;create policy app_party on applications for select to authenticated using(worker_id=auth.uid() or farmer_id=auth.uid());grant select on applications to authenticated;
   create table attendance_events(id uuid primary key default gen_random_uuid(),application_id uuid not null references applications(id),actor_id uuid not null,kind text not null check(kind in ('late','absent_notice','cancel','postpone','dispute_no_show','no_show_report','plan_mismatch','work_incomplete')),reason text,created_at timestamptz not null default now(),work_date date,detail text check(detail is null or detail in ('content','time','place','pay','other','stopped_early','could_not_work')));
   alter table attendance_events enable row level security;
   create policy att_read on attendance_events for select to authenticated using(exists(select 1 from applications a where a.id=attendance_events.application_id and (a.worker_id=auth.uid() or a.farmer_id=auth.uid())));
   create policy att_insert on attendance_events for insert to authenticated with check(actor_id=auth.uid() and exists(select 1 from applications a where a.id=attendance_events.application_id and (a.worker_id=auth.uid() or a.farmer_id=auth.uid())));
   grant select,insert on attendance_events to authenticated;
   create table notifications(farmer_id uuid,type text,message text);
   create table qa_email(recipient uuid,subject text,body text);create table qa_admin(type text,message text);
   create function send_user_email(uuid,text,text) returns void language sql as $$insert into qa_email values($1,$2,$3)$$;
   create function notify_admins(text,text) returns void language plpgsql as $$begin if current_setting('qa.fail',true)='yes' then raise exception 'injected notification failure';end if;insert into qa_admin values($1,$2);end$$;
   create function job_ref(integer,text) returns text language sql as $$select 'job '||$1::text$$;
   create function is_account_moderated(uuid) returns boolean language sql as $$select coalesce(current_setting('qa.moderated',true),'no')='yes'$$;`);
  await db.exec(await readFile(new URL('./fixtures/attendance-triggers.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261018152223_attendance_event_idempotent_save.sql',import.meta.url),'utf8'));
  const login=async who=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);await db.exec('set role authenticated');};
  const call=async(n,p=input,owner=own)=>(await db.query('select record_my_attendance_once($1,$2,$3) r',[owner,id(n),p])).rows[0].r;
  const counts=async()=>{await db.exec('reset role');const r=(await db.query('select (select count(*)::int from attendance_events) events,(select count(*)::int from notifications) notifications,(select count(*)::int from qa_email) emails,(select count(*)::int from qa_admin) admins')).rows[0];await db.exec('set role authenticated');return r;};
  await login(own);
  await t.test('normal save and repeated/lost-response replay fire notifications once',async()=>{
   const a=await call(1);assert.equal(a.ok,true);assert.equal(a.replayed,false);
   const [b,c]=await Promise.all([call(1),call(1)]);assert.equal(b.replayed,true);assert.deepEqual(b.row,a.row);assert.deepEqual(c.row,a.row);
   assert.deepEqual(await counts(),{events:1,notifications:1,emails:1,admins:1});
  });
  await t.test('same ID cannot substitute another payload or actor',async()=>{
   for(const patch of [{reason:'changed'},{detail:'time'},{work_date:'2026-10-19'},{kind:'late'}])assert.equal((await call(1,{...input,...patch})).reason,'request_mismatch');
   await login(farmer);assert.equal((await call(1,input,farmer)).reason,'request_mismatch');await login(own);
   assert.deepEqual(await counts(),{events:1,notifications:1,emails:1,admins:1});
  });
  await t.test('notification failure rolls back report and all transactional side effects; same ID retries',async()=>{
   await db.query("select set_config('qa.fail','yes',false)");assert.equal((await call(2)).reason,'save_rejected');assert.deepEqual(await counts(),{events:1,notifications:1,emails:1,admins:1});
   await db.query("select set_config('qa.fail','no',false)");assert.equal((await call(2)).ok,true);assert.deepEqual(await counts(),{events:2,notifications:2,emails:2,admins:2});
  });
  await t.test('disputes with null day/detail replay the same immutable row',async()=>{
   const p={application_id:app,kind:'dispute_no_show',reason:'欠勤していません'};const a=await call(3,p);assert.equal(a.ok,true);assert.equal(a.row.work_date,null);assert.deepEqual((await call(3,p)).row,a.row);assert.deepEqual(await counts(),{events:3,notifications:3,emails:3,admins:3});
  });
  await t.test('RLS, moderation, owner guard, invalid input and anonymous access fail without writes',async()=>{
   await login(stranger);assert.equal((await call(4,input,stranger)).reason,'save_rejected');await login(own);
   assert.equal((await call(4,input,farmer)).reason,'not_logged_in');
   await db.query("select set_config('qa.moderated','yes',false)");assert.equal((await call(4)).reason,'save_rejected');await db.query("select set_config('qa.moderated','no',false)");
   for(const p of [{...input,actor_id:farmer},{...input,work_date:'invalid'},{...input,kind:null}])assert.equal((await call(4,p)).reason,'invalid_input');
   assert.equal((await call(4,{...input,detail:'invalid'})).reason,'save_rejected');
   await db.exec('set role anon');await assert.rejects(call(4),/permission denied/);await login(own);
   assert.deepEqual(await counts(),{events:3,notifications:3,emails:3,admins:3});
  });
  await t.test('zero affected rows are not a successful save',async()=>{
   await db.exec(`reset role;create function qa_skip() returns trigger language plpgsql as $$begin return null;end$$;create trigger z_qa_skip before insert on attendance_events for each row execute function qa_skip();set role authenticated;`);
   assert.equal((await call(4)).reason,'save_rejected');assert.equal((await counts()).events,3);
   const f=(await db.query("select prosecdef,proconfig from pg_proc where proname='record_my_attendance_once'")).rows[0];assert.equal(f.prosecdef,false);assert.ok(f.proconfig.includes('search_path=""'));
  });
 }finally{await db.close();}
});
