#!/usr/bin/env python3
"""Real PostgreSQL concurrency tests. Requires libpq and a disposable local server.
Run: python3 scripts/operator-greetings-concurrency.test.py --port 55439
Only loopback is accepted, creates a uniquely named test database, drops it on exit.
Synthetic baseline: does not connect to Supabase or issue any HTTP requests.
"""
import argparse, concurrent.futures as futures, ctypes as C, ctypes.util, hashlib, json, os, pathlib, re, threading, time, uuid

lib = C.CDLL(ctypes.util.find_library('pq'))
for name, args, result in [('PQconnectdb',[C.c_char_p],C.c_void_p),('PQstatus',[C.c_void_p],C.c_int),('PQerrorMessage',[C.c_void_p],C.c_char_p),('PQexec',[C.c_void_p,C.c_char_p],C.c_void_p),('PQresultStatus',[C.c_void_p],C.c_int),('PQresultErrorMessage',[C.c_void_p],C.c_char_p),('PQntuples',[C.c_void_p],C.c_int),('PQnfields',[C.c_void_p],C.c_int),('PQgetvalue',[C.c_void_p,C.c_int,C.c_int],C.c_char_p),('PQclear',[C.c_void_p],None),('PQfinish',[C.c_void_p],None)]:
    fn=getattr(lib,name);fn.argtypes=args;fn.restype=result
class DB:
    def __init__(self, database):
        self.p=lib.PQconnectdb(f'host=127.0.0.1 hostaddr=127.0.0.1 port={port} user={args.user} dbname={database} connect_timeout=5 sslmode=disable passfile=/dev/null'.encode())
        if lib.PQstatus(self.p): raise RuntimeError(lib.PQerrorMessage(self.p).decode())
        self.q("set statement_timeout='12s'; set lock_timeout='10s'")
    def q(self, sql):
        r=lib.PQexec(self.p,sql.encode())
        try:
            if lib.PQresultStatus(r) not in (1,2): raise RuntimeError(lib.PQresultErrorMessage(r).decode())
            return [[lib.PQgetvalue(r,i,j).decode() for j in range(lib.PQnfields(r))] for i in range(lib.PQntuples(r))]
        finally:lib.PQclear(r)
    def close(self):
        if self.p:lib.PQfinish(self.p);self.p=None

def quote(v):return "'"+str(v).replace("'","''")+"'"
def identity(c,u,s):
    c.q(f"select set_config('request.jwt.claim.sub',{quote(u)},false),set_config('request.jwt.claims',{quote(json.dumps({'sub':u,'session_id':s}))},false); set role authenticated")
def rpc(c,u,s,record=True):return json.loads(c.q(f"select public.deliver_my_operator_greetings('{u}','{s}',{str(record).lower()})")[0][0])
def count(u):return int(admin.q(f"select count(*) from admin_messages where user_id='{u}'")[0][0])
def fixture(account=True,sessions=1):
    u=str(uuid.uuid4()); ss=[str(uuid.uuid4()) for _ in range(sessions)]
    admin.q(f"insert into auth.users(id) values('{u}');insert into push_subscriptions values('{u}');")
    for s in ss:admin.q(f"insert into auth.sessions(id,user_id) values('{s}','{u}')")
    if account:
        # Existing users must predate activation, so seed with trigger disabled.
        admin.q(f"alter table account_holders disable trigger queue_operator_registration_greeting;insert into account_holders(auth_id) values('{u}');alter table account_holders enable trigger queue_operator_registration_greeting")
    return u,ss

def client(u,s):
    c=DB(dbname);identity(c,u,s);return c

def parallel(u,ss,record=True):
    barrier=threading.Barrier(len(ss));pids=[];lock=threading.Lock()
    def call(s):
        c=client(u,s)
        try:
            with lock:pids.append(c.q('select pg_backend_pid()')[0][0])
            barrier.wait(5);return rpc(c,u,s,record)
        finally:c.close()
    with futures.ThreadPoolExecutor(max_workers=len(ss)) as pool:out=list(pool.map(call,ss))
    assert len(set(pids))==len(ss), 'Each attempt must have a distinct actual PostgreSQL backend'
    return out

def passed(name):print('PASS '+name,flush=True)
def await_blocked(pid):
    until=time.monotonic()+5
    while time.monotonic()<until:
        row=admin.q(f"select wait_event_type from pg_stat_activity where pid={pid}")
        if row and row[0][0]=='Lock':return
        time.sleep(.02)
    raise AssertionError(f'backend {pid} did not actually wait on a lock')

parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=55439);parser.add_argument('--user',default='agent');args=parser.parse_args();port=args.port
if not 1 <= port <= 65535: parser.error('--port must be in 1..65535')
if not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}[$]?', args.user):
    parser.error('--user must be a simple local OS username')
# Discard all libpq PG* environment inputs, including service/password/options,
# hostaddr, SSL certificate paths, passfile and settings added by future libpq.
# Explicit connection fields above then select only our loopback test server.
for key in list(os.environ):
    if key.startswith('PG'): os.environ.pop(key, None)

root=pathlib.Path(__file__).resolve().parent.parent
migration=root/'supabase/migrations/20261104090030_operator_auth_greetings.sql'
dbname='greeting_concurrency_'+uuid.uuid4().hex
control=DB('postgres');admin=None
try:
    control.q(f'create database {dbname}');admin=DB(dbname)
    # Roles are cluster-wide; this runner expects a disposable local cluster.
    admin.q("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;end$$")
    baseline=(root/'scripts/operator-greetings-db.test.mjs').read_text().split('await db.exec(`',1)[1].split(" insert into auth.users",1)[0]
    baseline=baseline.replace('create role anon;create role authenticated;','')
    admin.q(baseline)
    admin.q("create table account_moderation(auth_id uuid primary key,state text);create or replace function public.is_account_moderated(uuid) returns boolean language sql stable as $$select exists(select 1 from public.account_moderation where auth_id=$1 and state in ('suspended','banned'))$$")
    admin.q("""create schema net;create table public.test_push_calls(body jsonb);
      create table public.push_subscriptions(auth_id uuid);create table public.push_config(id int,trigger_secret text);
      insert into public.push_config values(1,'SYNTHETIC-NOT-A-SECRET');
      create function net.http_post(url text,headers jsonb,body jsonb) returns bigint language plpgsql as $$begin insert into public.test_push_calls values(body);return 1;end$$;""")
    preflight=json.loads((root/'scripts/fixtures/operator-greeting-preflight-20261104.json').read_text())
    admin.q(preflight['preflight']['push_function'])
    admin.q('create trigger trg_notify_push_admin_message after insert on public.admin_messages for each row execute function public.notify_push_on_admin_message()')
    source=migration.read_bytes();admin.q(source.decode())
    print('PostgreSQL: '+admin.q('select version()')[0][0]);print('Migration SHA256: '+hashlib.sha256(source).hexdigest())
    admin.q("update private.operator_greeting_config set enabled=true,enabled_at=now()-interval '1 hour',registration_body='REGISTRATION TEST',registration_named_body='REGISTRATION {{name}}',login_body='LOGIN TEST',login_named_body='LOGIN {{name}}'")
    u,ss=fixture();out=parallel(u,ss*8);assert sum(x['sent'] for x in out)==1 and count(u)==1;passed('8 concurrent attempts, same session, 8 distinct backends: exactly one chat')
    u,ss=fixture(sessions=8);out=parallel(u,ss);assert sum(x['sent'] for x in out)==8 and count(u)==8;passed('8 simultaneous distinct sessions: one chat per session')
    # Login first, registration still absent; durable registration then drain.
    u,ss=fixture(False);s=ss[0];a=client(u,s);b=client(u,s)
    assert rpc(a,u,s)['status']=='registration_pending';b.q(f"begin;insert into account_holders(auth_id) values('{u}')")
    assert rpc(a,u,s)['status']=='registration_pending';b.q('commit');assert sum(x['sent'] for x in parallel(u,[s]*4))==1
    assert admin.q(f"select kind from private.operator_greeting_events where user_id='{u}'")==[['registration']];a.close();b.close();passed('login before and during uncommitted registration: one welcome after commit')
    # Registration first commits before both concurrent login and restoration.
    u,ss=fixture(False);s=ss[0];a=client(u,s);a.q(f"insert into account_holders(auth_id) values('{u}')");a.close()
    assert sum(x['sent'] for x in parallel(u,[s]*8))==1 and count(u)==1
    assert admin.q(f"select kind from private.operator_greeting_events where user_id='{u}'")==[['registration']];passed('registration first, simultaneous login attempts: registration wins')
    # Lost successful response: deliberately discard result and disconnect.
    u,ss=fixture();s=ss[0];a=client(u,s);rpc(a,u,s);a.close();assert sum(x['sent'] for x in parallel(u,[s]*8))==0 and count(u)==1;passed('committed result discarded, disconnected client, concurrent retries: no duplicate')
    u,ss=fixture();s=ss[0];a=client(u,s);a.q('begin');assert rpc(a,u,s)['sent']==1;a.q('rollback');a.close();assert count(u)==0;assert sum(x['sent'] for x in parallel(u,[s]*4))==1;passed('outer transaction rollback removes receipt and chat; retry sends once')
    u,ss=fixture(False);s=ss[0];a=client(u,s);a.q(f"begin;insert into account_holders(auth_id) values('{u}');rollback");assert rpc(a,u,s)['status']=='registration_pending';assert admin.q(f"select count(*) from private.operator_greeting_events where user_id='{u}'")==[['0']];a.close();passed('registration rollback leaves neither account nor event nor chat')
    # Actual client disconnect with uncommitted work: server rolls back transaction.
    u,ss=fixture();s=ss[0];a=client(u,s);a.q('begin');rpc(a,u,s);a.close();assert sum(x['sent'] for x in parallel(u,[s]*4))==1 and count(u)==1;passed('connection lost before commit: rollback then concurrent retry delivers once')
    # Failed chat insert retains pending event but rolls back preassigned receipt.
    u,ss=fixture();s=ss[0]
    admin.q("create function test_chat_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic chat failure';end$$;create trigger test_chat_failure before insert on admin_messages for each row execute function test_chat_failure()")
    a=client(u,s);assert rpc(a,u,s)['status']=='retry';a.close();assert count(u)==0
    assert admin.q(f"select message_id is null from private.operator_greeting_events where user_id='{u}'")==[['t']]
    admin.q('drop trigger test_chat_failure on admin_messages');assert sum(x['sent'] for x in parallel(u,[s]*4,False))==1;passed('chat failure rolls back receipt; pending event drains exactly once across concurrent retries')
    # Revoke before greeting lock: deliver must wait and then fail closed.
    for mutation in ['logout','ban','delete','moderation']:
        u,ss=fixture();s=ss[0];a=DB(dbname);b=client(u,s);pid=b.q('select pg_backend_pid()')[0][0];a.q('begin')
        statement={'logout':f"delete from auth.sessions where id='{s}'",'ban':f"update auth.users set banned_until='infinity' where id='{u}'",'delete':f"update auth.users set deleted_at=now() where id='{u}'",'moderation':f"insert into account_moderation values('{u}','suspended');update auth.users set banned_until='infinity' where id='{u}'"}[mutation];a.q(statement)
        with futures.ThreadPoolExecutor() as pool:
            pending=pool.submit(rpc,b,u,s);await_blocked(pid);a.q('commit');assert pending.result()['status']=='stale'
        assert count(u)==0;a.close();b.close();passed(mutation+' commits first: blocked greeting resumes stale, no chat')
    # Greeting owns lock first: revocation must wait until its transaction finishes.
    for mutation in ['logout','ban','moderation']:
        u,ss=fixture();s=ss[0];a=client(u,s);b=DB(dbname);pid=b.q('select pg_backend_pid()')[0][0];a.q('begin');assert rpc(a,u,s)['sent']==1
        statement=f"delete from auth.sessions where id='{s}'" if mutation=='logout' else f"update auth.users set banned_until='infinity' where id='{u}'"
        if mutation=='moderation':statement=f"begin;insert into account_moderation values('{u}','suspended');"+statement+';commit'
        with futures.ThreadPoolExecutor() as pool:
            pending=pool.submit(b.q,statement);await_blocked(pid);a.q('commit');pending.result()
        assert count(u)==1 and rpc(a,u,s)['status']=='stale';a.close();b.close();passed('greeting commits before '+mutation+': revocation serialized, later retry stale')
    assert admin.q('select count(*) from test_push_calls')==[['0']];passed('all automatic chats generated zero HTTP/push calls')
    u,ss=fixture();admin.q(f"insert into admin_messages(user_id,from_admin,body) values('{u}',true,'MANUAL TEST')");assert admin.q('select count(*) from test_push_calls')==[['1']];passed('manual operator chat still invokes synthetic push exactly once')
    print('ALL CONCURRENCY TESTS PASSED',flush=True)
finally:
    if admin:admin.close()
    control.q(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{dbname}'")
    control.q(f'drop database if exists {dbname}');control.close()
