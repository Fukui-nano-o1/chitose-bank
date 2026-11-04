import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const user='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const fresh='10000000-0000-4000-8000-000000000003',disabled='10000000-0000-4000-8000-000000000004';
const sid=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('operator greetings: private queue, session dedupe, registration overlap and rollback in Postgres',async t=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth to authenticated;grant execute on all functions in schema auth to authenticated;
 create table auth.users(id uuid primary key,banned_until timestamptz,deleted_at timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz default now());
 create table public.account_holders(id uuid primary key default gen_random_uuid(),auth_id uuid unique references auth.users(id));
 create table public.worker_profiles(auth_id uuid primary key,nickname text);
 create table public.employer_profiles(auth_id uuid primary key,nickname text);
 create table public.admin_messages(id uuid primary key default gen_random_uuid(),user_id uuid,from_admin boolean,body text,read_at timestamptz);
 create function public.is_account_moderated(uuid) returns boolean language sql stable as $$select false$$;
 alter table public.account_holders enable row level security;alter table public.admin_messages enable row level security;
 create policy account_own on public.account_holders to authenticated using(auth_id=auth.uid()) with check(auth_id=auth.uid());
 create policy message_own on public.admin_messages for select to authenticated using(user_id=auth.uid());
 grant select,insert,update on public.account_holders to authenticated;grant select on public.admin_messages to authenticated;
 insert into auth.users(id) values('${user}'),('${other}'),('${fresh}'),('${disabled}');
 insert into auth.sessions(id,user_id,created_at) values('${sid(1)}','${user}',now()),('${sid(2)}','${user}',now()),('${sid(3)}','${other}',now()),('${sid(4)}','${fresh}',now()),('${sid(5)}','${disabled}',now()),('${sid(6)}','${user}',now()-interval '1 year');
 insert into account_holders(auth_id) values('${user}'),('${other}');
 insert into worker_profiles values('${user}','働き手名');insert into employer_profiles values('${user}','農園名'),('${other}','別の農園');`);
 const preflight=JSON.parse(await readFile(new URL('./fixtures/operator-greeting-preflight-20261104.json',import.meta.url),'utf8')).preflight;
 await db.exec(preflight.push_function);
 await db.exec(`create schema net;create table public.fixture_push_requests(payload jsonb);
 create table public.push_subscriptions(auth_id uuid);create table public.push_config(id integer,trigger_secret text);
 insert into public.push_subscriptions select id from auth.users;insert into public.push_config values(1,'synthetic-only');
 create function net.http_post(url text,headers jsonb,body jsonb) returns bigint language plpgsql as $$begin insert into public.fixture_push_requests values(body);return 1;end;$$;
 create trigger trg_notify_push_admin_message after insert on public.admin_messages for each row execute function public.notify_push_on_admin_message();`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261104090030_operator_auth_greetings.sql',import.meta.url),'utf8'));
 const login=async(u,s)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[u||'',JSON.stringify({sub:u,session_id:s})]);await db.exec(u?'set role authenticated':'set role anon');};
 const rpc=async(u,s,record=false)=>(await db.query('select public.deliver_my_operator_greetings($1,$2,$3) as result',[u,s,record])).rows[0].result;
 const count=async()=>(await db.query('select count(*)::int as n from public.admin_messages')).rows[0].n;
 await t.test('approved copy remains disabled with no queue, messages, or retroactive registration',async()=>{
  await login(disabled,sid(5));assert.equal((await rpc(disabled,sid(5),true)).status,'disabled');
  await db.query('insert into account_holders(auth_id) values($1)',[disabled]);assert.equal(await count(),0);
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from private.operator_greeting_events')).rows[0].n,0);
  await assert.rejects(db.exec('update private.operator_greeting_config set enabled=true'),/check constraint/);
  await db.exec("update private.operator_greeting_config set enabled=true,enabled_at=now()-interval '1 hour',registration_body='REGISTRATION TEST ONLY',registration_named_body='REGISTRATION TEST {{name}}',login_body='LOGIN TEST ONLY',login_named_body='LOGIN TEST {{name}}'");
 });
 await t.test('display names prefer worker, fall back to employer, and omit missing names without private identity lookup',async()=>{
  const render=async(id)=>(await db.query("select private.render_operator_greeting($1,'TEST {{name}}','TEST NO NAME') as body",[id])).rows[0].body;
  await db.exec('reset role');assert.equal(await render(user),'TEST 働き手名');assert.equal(await render(other),'TEST 別の農園');assert.equal(await render(fresh),'TEST NO NAME');
  await db.query('insert into public.worker_profiles(auth_id,nickname) values($1,$2)',[other,' \n\t ']);assert.equal(await render(other),'TEST 別の農園');
  await db.query('update public.worker_profiles set nickname=$1 where auth_id=$2',['長'.repeat(100)+'\n',other]);assert.equal(await render(other),'TEST '+'長'.repeat(80));
  await db.query('delete from public.worker_profiles where auth_id=$1',[other]);
 });
 await t.test('ordinary restores send nothing; each genuine session sends at most once',async()=>{
  await login(user,sid(1));assert.equal((await rpc(user,sid(1))).status,'idle');assert.equal(await count(),0);
  assert.equal((await rpc(user,sid(1),true)).sent,1);
  assert.equal((await db.query('select body from public.admin_messages')).rows[0].body,'LOGIN TEST 働き手名');
  const repeats=await Promise.all(Array.from({length:8},()=>rpc(user,sid(1),true)));
  assert.ok(repeats.every(r=>r.sent===0));assert.equal(await count(),1);
  await login(user,sid(2));assert.equal((await rpc(user,sid(2),true)).sent,1);assert.equal(await count(),2);
 });
 await t.test('registration wins same-session overlap and is queued only after committed account save',async()=>{
  await login(fresh,sid(4));assert.equal((await rpc(fresh,sid(4),true)).status,'registration_pending');
  await db.query('insert into account_holders(auth_id) values($1)',[fresh]);assert.equal(await count(),0,'no chat/push during registration save');
  assert.equal((await rpc(fresh,sid(4),true)).sent,1);
  assert.equal((await rpc(fresh,sid(4),true)).sent,0);
  assert.deepEqual((await db.query('select body from public.admin_messages')).rows,[{body:'REGISTRATION TEST ONLY'}]);
  await db.query('insert into account_holders(auth_id) values($1) on conflict(auth_id) do update set auth_id=excluded.auth_id',[fresh]);
  assert.equal((await rpc(fresh,sid(4))).sent,0);
 });
 await t.test('stale sessions, other accounts, pre-activation sessions, banned and deleted users fail closed',async()=>{
  await login(user,sid(1));assert.equal((await rpc(other,sid(3),true)).status,'stale');assert.equal((await rpc(user,sid(2),true)).status,'stale');
  await login(user,sid(6));assert.equal((await rpc(user,sid(6),true)).status,'stale');
  await db.exec(`reset role;delete from auth.sessions where id='${sid(2)}'`);await login(user,sid(2));assert.equal((await rpc(user,sid(2),true)).status,'stale');
  await db.exec(`reset role;update auth.users set banned_until='infinity' where id='${user}'`);await login(user,sid(1));assert.equal((await rpc(user,sid(1),true)).status,'stale');
  await db.exec(`reset role;update auth.users set banned_until=null,deleted_at=now() where id='${user}'`);await login(user,sid(1));assert.equal((await rpc(user,sid(1),true)).status,'stale');
  await db.exec(`reset role;update auth.users set deleted_at=null where id='${user}'`);
 });
 await t.test('chat failure preserves a durable login event; retry sends once',async()=>{
  await db.exec(`reset role;create function public.fixture_chat_failure() returns trigger language plpgsql as $$begin raise exception 'fixture failure';end;$$;
   create trigger fixture_chat_failure before insert on public.admin_messages for each row execute function public.fixture_chat_failure();`);
  await login(other,sid(3));assert.equal((await rpc(other,sid(3),true)).status,'retry');
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from private.operator_greeting_events where user_id=$1 and message_id is null',[other])).rows[0].n,1);
  await db.exec('drop trigger fixture_chat_failure on public.admin_messages');
  await login(other,sid(3));assert.equal((await rpc(other,sid(3),false)).sent,1);assert.equal((await rpc(other,sid(3),true)).sent,0);
 });
 await t.test('registration commits while chat is broken, then its queued welcome retries exactly once',async()=>{
  const newcomer='10000000-0000-4000-8000-000000000005';
  await db.exec(`reset role;insert into auth.users(id) values('${newcomer}');insert into auth.sessions(id,user_id) values('${sid(7)}','${newcomer}');
   create trigger fixture_chat_failure before insert on public.admin_messages for each row execute function public.fixture_chat_failure();`);
  await login(newcomer,sid(7));await db.query('insert into account_holders(auth_id) values($1)',[newcomer]);
  assert.equal((await rpc(newcomer,sid(7))).status,'retry');assert.equal(await count(),0);
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from private.operator_greeting_events where user_id=$1 and message_id is null',[newcomer])).rows[0].n,1);
  await db.exec('drop trigger fixture_chat_failure on public.admin_messages');
  await login(newcomer,sid(7));assert.equal((await rpc(newcomer,sid(7))).sent,1);assert.equal((await rpc(newcomer,sid(7),true)).sent,0);
 });
 await t.test('automatic greetings never enqueue push; manual operator chat retains push',async()=>{
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from public.fixture_push_requests')).rows[0].n,0);
  const id='30000000-0000-4000-8000-000000000001';
  await db.query('insert into public.admin_messages(id,user_id,from_admin,body) values($1,$2,true,$3)',[id,user,'MANUAL TEST ONLY']);
  const requests=(await db.query('select payload from public.fixture_push_requests')).rows;
  assert.deepEqual(requests,[{payload:{recipient_id:user,kind:'admin',id}}]);
  await db.query('insert into public.admin_messages(user_id,from_admin,body) values($1,false,$2)',[user,'USER REPLY TEST ONLY']);
  assert.equal((await db.query('select count(*)::int as n from public.fixture_push_requests')).rows[0].n,1);
 });
 await t.test('private tables and trigger are inaccessible; public wrapper is invoker and anon cannot send',async()=>{
  await login(user,sid(1));await assert.rejects(db.query('select * from private.operator_greeting_config'),/permission denied/);
  await assert.rejects(db.query('insert into private.operator_greeting_events(user_id,kind,body) values($1,\'registration\',\'forged\')',[user]),/permission denied/);
  await assert.rejects(db.query('insert into public.admin_messages(user_id,from_admin,body) values($1,true,\'forged\')',[user]),/permission denied/);
  await login(null,null);await assert.rejects(rpc(user,sid(1),true),/permission denied/);
  await db.exec('reset role');const fn=(await db.query("select p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='deliver_my_operator_greetings'")).rows[0];
  assert.equal(fn.prosecdef,false);assert.ok(fn.proconfig.includes('search_path=""'));
  assert.equal((await db.query("select has_function_privilege('authenticated','private.queue_operator_registration_greeting()','execute') as allowed")).rows[0].allowed,false);
 });
 }finally{await db.close();}
});
