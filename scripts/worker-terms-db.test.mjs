import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const worker='00000000-0000-4000-8000-000000000001',farmer='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
const aid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('worker confirmation, frozen snapshot, message and transactional notifications commit together',async t=>{
 const db=new PGlite();
 try{
  await db.exec(`set timezone='UTC';create role anon;create role authenticated;create schema auth;create schema private;create schema net;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,private to authenticated;
   create table jobs(job_number integer primary key,crop text,task text,headcount integer,status text,lat numeric,lng numeric);insert into jobs values(17,'野菜','収穫',10,'open',1,2);
   create table applications(id uuid primary key,worker_id uuid,farmer_id uuid,job_number integer,status text,terms_confirmed_worker_at timestamptz,terms_confirmed_farmer_at timestamptz,terms_snapshot jsonb,decided_at timestamptz);
   insert into applications select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${worker}','${farmer}',17,'approved',null,now(),null,null from generate_series(1,9) n;
   alter table applications enable row level security;create policy app_party on applications for select to authenticated using(worker_id=auth.uid() or farmer_id=auth.uid());grant select on applications to authenticated;
   create table account_holders(auth_id uuid primary key,full_name text);insert into account_holders values('${worker}','試験働き手'),('${farmer}','試験募集主');
   create table employer_profiles(auth_id uuid,nickname text);
   create table messages(id uuid primary key default gen_random_uuid(),application_id uuid not null references applications(id),sender_id uuid not null,body text not null,created_at timestamptz not null default now(),read_at timestamptz);
   alter table messages enable row level security;create policy msg_party on messages for select to authenticated using(exists(select 1 from applications a where a.id=application_id and (a.worker_id=auth.uid() or a.farmer_id=auth.uid())));grant select on messages to authenticated;
   create table notifications(farmer_id uuid,type text,message text);create table qa_email(recipient uuid);create table qa_push(body jsonb);
   create table push_subscriptions(auth_id uuid);insert into push_subscriptions values('${farmer}');create table push_config(id integer,trigger_secret text);insert into push_config values(1,'fixture');
   create function net.http_post(url text,headers jsonb,body jsonb) returns bigint language plpgsql as $$begin insert into qa_push values(body);return 1;end$$;
   create function chat_message_mail_send(uuid,text,text,text) returns void language sql as $$insert into qa_email values($1)$$;
   create function h(text) returns text language sql as $$select $1$$;create function job_ref(integer,text) returns text language sql as $$select 'job '||$1::text$$;
   create function resolve_actor_name(uuid) returns text language sql as $$select '試験本人'::text$$;
   create function is_account_moderated(uuid) returns boolean language sql as $$select coalesce(current_setting('qa.moderated',true),'no')='yes'$$;
   create function app_phase(applications) returns text language sql as $$select ($1).status$$;create function app_work_dates(uuid) returns setof date language sql as $$select '2099-12-01'::date$$;
   create function send_user_email(uuid,text,text) returns void language sql as $$insert into qa_email values($1)$$;
   create function qa_message_failure() returns trigger language plpgsql as $$begin if current_setting('qa.message_fail',true)='yes' then raise exception 'message rejected';end if;if current_setting('qa.message_skip',true)='yes' then return null;end if;return new;end$$;
   create trigger qa_message_failure before insert on messages for each row execute function qa_message_failure();
   create function qa_notification_failure() returns trigger language plpgsql as $$begin if current_setting('qa.notification_fail',true)='yes' then raise exception 'notification rejected';end if;return new;end$$;
   create trigger qa_notification_failure before insert on notifications for each row execute function qa_notification_failure();`);
  await db.exec(await readFile(new URL('./fixtures/worker-terms-production.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261018153139_worker_terms_atomic_confirmation.sql',import.meta.url),'utf8'));
  const login=async who=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);await db.exec('set role authenticated');};
  const call=async(n,owner=worker)=>(await db.query('select confirm_my_worker_terms($1,$2) r',[owner,aid(n)])).rows[0].r;
  const app=async n=>(await db.query('select to_jsonb(a) r from applications a where id=$1',[aid(n)])).rows[0]?.r;
  const counts=async()=>{await db.exec('reset role');const r=(await db.query('select (select count(*)::int from messages) messages,(select count(*)::int from notifications) notifications,(select count(*)::int from qa_email) emails,(select count(*)::int from qa_push) pushes')).rows[0];await db.exec('set role authenticated');return r;};
  await login(worker);
  await t.test('first confirmation freezes the same job snapshot and sends one record; replay changes nothing',async()=>{
   const r=await call(1);assert.equal(r.ok,true);assert.equal(r.already,false);assert.ok(r.message_id);const a=await app(1);assert.ok(a.terms_confirmed_worker_at);assert.equal(a.terms_snapshot.crop,'野菜');assert.equal(a.terms_snapshot.lat,undefined);assert.equal(a.terms_snapshot.party_names.worker,'試験働き手');
   const [b,c]=await Promise.all([call(1),call(1)]);assert.equal(b.already,true);assert.equal(c.already,true);assert.deepEqual(await app(1),a);assert.deepEqual(await counts(),{messages:1,notifications:1,emails:1,pushes:1});
  });
  await t.test('message failure, notification failure and zero-row INSERT each roll back confirmation and snapshot',async()=>{
   for(const [n,key] of [[2,'qa.message_fail'],[3,'qa.notification_fail'],[4,'qa.message_skip']]){await db.query('select set_config($1,\'yes\',false)',[key]);const r=await call(n);assert.equal(r.reason,'save_rejected');assert.equal((await app(n)).terms_confirmed_worker_at,null);assert.equal((await app(n)).terms_snapshot,null);assert.deepEqual(await counts(),{messages:1,notifications:1,emails:1,pushes:1});await db.query('select set_config($1,\'no\',false)',[key]);}
   assert.equal((await call(2)).ok,true);assert.equal((await counts()).messages,2);
  });
  await t.test('wrong owner, nonworker, anonymous, closed work and moderated user cannot confirm',async()=>{
   assert.equal((await call(5,other)).reason,'not_logged_in');await login(farmer);assert.equal((await call(5,farmer)).reason,'not_party');await login(other);assert.equal((await call(5,other)).reason,'not_party');await login(worker);
   await db.exec(`reset role;update applications set status='completed' where id='${aid(5)}';set role authenticated;`);assert.equal((await call(5)).reason,'closed');
   await db.query("select set_config('qa.moderated','yes',false)");assert.equal((await call(6)).reason,'moderated');await db.query("select set_config('qa.moderated','no',false)");
   await db.exec('set role anon');await assert.rejects(call(6),/permission denied/);await login(worker);assert.equal((await counts()).messages,2);
  });
  await t.test('new-application stamp and existing confirmations do not create retrospective messages',async()=>{
   await db.exec(`reset role;insert into applications(id,worker_id,farmer_id,job_number,status) values('${aid(10)}','${worker}','${farmer}',17,'approved');set role authenticated;`);
   assert.ok((await app(10)).terms_confirmed_worker_at);assert.equal((await call(10)).already,true);assert.equal((await counts()).messages,2);
  });
  await t.test('retired worker branch cannot split save; farmer hiring branch is byte-for-byte preserved and still works',async()=>{
   const before=(await db.query("select prosrc from pg_proc where oid='public.confirm_terms(uuid,boolean)'::regprocedure")).rows[0].prosrc;
   await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/migrations/20261018153253_retire_split_worker_terms_confirmation.sql',import.meta.url),'utf8'));await login(worker);
   const after=(await db.query("select prosrc from pg_proc where oid='public.confirm_terms(uuid,boolean)'::regprocedure")).rows[0].prosrc;
   assert.equal(after.split('  elsif auth.uid() = v_farmer then')[1],before.split('  elsif auth.uid() = v_farmer then')[1]);
   assert.equal((await db.query('select confirm_terms($1) r',[aid(7)])).rows[0].r.reason,'use_worker_confirmation');assert.equal((await app(7)).terms_confirmed_worker_at,null);
   await db.exec(`reset role;insert into applications(id,worker_id,farmer_id,job_number,status) values('${aid(11)}','${worker}','${farmer}',17,'approved');`);await login(farmer);
   assert.equal((await db.query('select confirm_terms($1) r',[aid(11)])).rows[0].r.ok,true);assert.ok((await app(11)).terms_snapshot);await login(worker);
  });
 }finally{await db.close();}
});
