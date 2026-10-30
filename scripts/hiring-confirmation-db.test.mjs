import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Targeted synthetic fixture, not a production data/schema dump. JWT subjects are
// simulated and email delivery is an inert table INSERT. PGlite is one session:
// these tests cover repeated requests, NOT real concurrent transactions.
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const farmer = id(1), worker = id(2), other = id(3), app = id(10), sibling = id(11);
const read = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const baseline = await read('20261018154909_retire_split_worker_terms_confirmation.sql');
const patch = await read('20261030064218_guard_first_hiring_confirmation.sql');
// Read only each named existing helper definition, never replay a migration directory.
const definition = (source, name) => {
  const match = source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`, 'i'));
  assert.ok(match, `missing fixture helper ${name}`);
  return match[0];
};

test('first hiring confirmation guards and no-write replay', async t => {
  const db = new PGlite();
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const rpc = async (accept = false) => (await rows('select public.confirm_terms($1,$2) result', [app, accept]))[0].result;
  const login = async (who = farmer, role = 'authenticated') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who || '']);
    await db.exec(`set role ${role}`);
  };
  const state = async () => {
    await db.exec('reset role');
    return (await rows(`select jsonb_build_object(
      'applications',(select jsonb_agg(to_jsonb(a) order by id) from applications a),
      'jobs',(select jsonb_agg(to_jsonb(j) order by job_number) from jobs j),
      'messages',(select jsonb_agg(to_jsonb(m) order by id) from messages m),
      'notifications',(select jsonb_agg(to_jsonb(n) order by id) from notifications n),
      'emails',(select jsonb_agg(to_jsonb(e) order by id) from qa_email e),
      'updates',(select count(*) from qa_update)) value`))[0].value;
  };
  const scenario = async (name, setup, run) => t.test(name, async () => {
    await db.exec('reset role; begin');
    try {
      if (setup) await db.exec(setup);
      await db.exec('truncate qa_update');
      await run();
    } finally { await db.exec('rollback; reset role'); }
  });
  const denied = async (setup, reason, actor = farmer) => {
    if (setup) await db.exec(setup);
    const before = await state();
    await login(actor);
    assert.equal((await rpc()).reason, reason);
    assert.deepEqual(await state(), before);
  };
  try {
    await db.exec(`set timezone='UTC'; create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon;
      create table auth.users(id uuid primary key,banned_until timestamptz);
      insert into auth.users(id) values('${farmer}'),('${worker}'),('${other}');
      create table account_moderation(auth_id uuid primary key,state text);
      create function public.is_account_moderated(p_uid uuid) returns boolean language sql stable security definer set search_path='' as $$
        select exists(select 1 from public.account_moderation where auth_id=p_uid and state in ('suspended','banned'))$$;
      create table jobs(job_number integer primary key,farmer_id uuid,status text,headcount integer,
        date_start date,date_end date,work_time text,holidays jsonb default '[]',crop text,task text,lat numeric,lng numeric);
      -- Status deliberately has no CHECK/NOT NULL here, so counterfactual future
      -- unknown/null schema inputs exercise the function's default-deny guard.
      create table applications(id uuid primary key,worker_id uuid,farmer_id uuid,job_number integer,status text,
        terms_confirmed_worker_at timestamptz,terms_confirmed_farmer_at timestamptz,terms_snapshot jsonb,
        agreed_dates jsonb,decided_at timestamptz);
      create table employer_profiles(auth_id uuid,nickname text);
      create table messages(id bigint generated always as identity,application_id uuid,sender_id uuid,body text);
      create table notifications(id bigint generated always as identity,farmer_id uuid,type text,message text);
      create table qa_email(id bigint generated always as identity,recipient uuid);
      create table qa_update(table_name text);
      create function public.send_user_email(uuid,text,text) returns void language sql as $$insert into public.qa_email(recipient) values($1)$$;
      create function public.job_ref(integer,text) returns text language sql as $$select 'synthetic job '||$1::text$$;
      create function qa_track_update() returns trigger language plpgsql as $$begin insert into public.qa_update values(tg_table_name);return new;end$$;
      create trigger qa_app_update after update on applications for each row execute function qa_track_update();
      create trigger qa_job_update after update on jobs for each row execute function qa_track_update();
      insert into jobs values(17,'${farmer}','open',10,'2099-01-10','2099-01-11','08:00〜17:00','[]','試験作物','試験作業',1,2);
      insert into applications(id,worker_id,farmer_id,job_number,status,terms_confirmed_worker_at)
        values('${app}','${worker}','${farmer}',17,'approved',now()),('${sibling}','${other}','${farmer}',17,'approved',now());`);
    await db.exec(definition(await read('20260816040500_cancel_application_keeps_record.sql'), 'app_phase'));
    await db.exec(definition(await read('20260807021418_app_work_dates_null_agreed_fix.sql'), 'app_work_dates'));
    await db.exec(definition(await read('20260819094803_complete_only_after_final_day_end.sql'), 'app_work_due_at'));
    // The frozen-snapshot trigger is the existing production definition, not a
    // weaker mock. Other unrelated worker-confirmation fixture triggers are not loaded.
    const workerFixture = await readFile(new URL('./fixtures/worker-terms-production.sql', import.meta.url), 'utf8');
    await db.exec(definition(workerFixture, 'trg_protect_terms_snapshot'));
    await db.exec('create trigger protect_terms_snapshot before update or delete on applications for each row execute function trg_protect_terms_snapshot()');
    await db.exec(baseline);
    await db.exec('revoke all on function public.confirm_terms(uuid,boolean) from public; grant execute on function public.confirm_terms(uuid,boolean) to authenticated,service_role');
    assert.equal((await rows("select md5(pg_get_functiondef('public.confirm_terms(uuid,boolean)'::regprocedure)) hash"))[0].hash,
      'd9c0da2e9adcf5faedc4ea06d937a428');

    await scenario('baseline reproduces canceled confirmation, job closure and sibling rejection',
      `update applications set status='canceled' where id='${app}';update jobs set headcount=1`, async () => {
        await login(); const result = await rpc(); assert.equal(result.ok, true); assert.equal(result.filled, true);
        const after = await state();
        assert.ok(after.applications.find(a => a.id === app).terms_snapshot);
        assert.equal(after.applications.find(a => a.id === sibling).status, 'rejected');
        assert.equal(after.jobs[0].status, 'closed');
      });
    for (const [label, drift] of [
      ['definition', "alter function public.confirm_terms(uuid,boolean) set search_path='pg_catalog'"],
      ['ACL', 'grant execute on function public.confirm_terms(uuid,boolean) to anon'],
      ['owner', 'alter function public.confirm_terms(uuid,boolean) owner to service_role'],
    ]) await scenario(`preflight refuses ${label} drift`, drift, async () => {
      const before = (await rows("select pg_get_functiondef(oid) definition,proacl::text acl,proowner from pg_proc where oid='public.confirm_terms(uuid,boolean)'::regprocedure"))[0];
      await db.exec('savepoint preflight');
      await assert.rejects(db.exec(patch), /HIRING_PREFLIGHT_DRIFT/);
      await db.exec('rollback to savepoint preflight');
      assert.deepEqual((await rows("select pg_get_functiondef(oid) definition,proacl::text acl,proowner from pg_proc where oid='public.confirm_terms(uuid,boolean)'::regprocedure"))[0], before);
    });
    await db.exec(patch);
    const acl = (await rows("select proacl::text acl,prosecdef,proconfig from pg_proc where oid='public.confirm_terms(uuid,boolean)'::regprocedure"))[0];
    assert.equal(acl.acl, '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}');
    assert.equal(acl.prosecdef, true); assert.deepEqual(acl.proconfig, ['search_path=""']);

    for (const status of ['approved','meeting','interview']) await scenario(`normal ${status} confirms once`,
      `update applications set status='${status}' where id='${app}'`, async () => {
        await login(); const first = await rpc(); assert.equal(first.ok, true); assert.equal(first.filled, false);
        const before = await state(); const saved = before.applications.find(a => a.id === app);
        assert.ok(saved.terms_confirmed_farmer_at); assert.ok(saved.terms_snapshot);
        assert.equal(saved.terms_snapshot.lat, undefined); assert.equal(saved.terms_snapshot.lng, undefined);
        assert.equal(before.messages.length, 1); assert.equal(before.emails.length, 1);
        await login(); assert.equal((await rpc()).ok, true); assert.deepEqual(await state(), before);
      });
    for (const status of ['applied','contracted','working','completed','rejected','expired','canceled','future_unknown',null]) {
      await scenario(`first-confirm status ${status} changes nothing`, '', () => denied(
        `update applications set status=${status === null ? 'null' : `'${status}'`} where id='${app}';update jobs set headcount=1`,
        'application_not_hirable'));
    }
    for (const [actor, reason] of [[worker,'use_worker_confirmation'],[other,'not_party'],[null,'not_party']]) {
      await scenario(`actor ${actor || 'missing subject'} is refused`, '', () => denied('', reason, actor));
    }
    await scenario('anon lacks EXECUTE', '', async () => {
      await db.exec('savepoint anonymous'); await login(null, 'anon');
      await assert.rejects(rpc(), error => error.code === '42501');
      await db.exec('rollback to savepoint anonymous');
    });
    for (const [person, reason, label] of [[farmer,'account_suspended','caller'],[worker,'worker_suspended','target']]) {
      for (const status of ['suspended','banned']) await scenario(`${label} moderation ${status}`, '', () => denied(
        `insert into account_moderation values('${person}','${status}')`, reason));
      await scenario(`${label} Auth ban`, '', () => denied(`update auth.users set banned_until='infinity' where id='${person}'`, reason));
      await scenario(`${label} expired Auth ban permits normal confirmation`, `update auth.users set banned_until=now()-interval '1 second' where id='${person}'`, async () => {
        await login(); assert.equal((await rpc()).ok, true);
      });
    }
    for (const status of ['closed','draft','pending','rejected','unknown',null]) await scenario(`job ${status} changes nothing`, '', () => denied(
      `update jobs set status=${status === null ? 'null' : `'${status}'`}`, 'job_not_open'));
    await scenario('missing job is refused without changing application', '', () => denied('delete from jobs', 'job_not_found'));
    await scenario('job belongs to a different farmer', '', () => denied(`update jobs set farmer_id='${other}'`, 'job_not_found'));
    await scenario('missing target Auth account is refused', '', () => denied(`delete from auth.users where id='${worker}'`, 'worker_suspended'));
    for (const capacity of [0,-1,null]) await scenario(`invalid capacity ${capacity}`, '', () => denied(`update jobs set headcount=${capacity ?? 'null'}`, 'invalid_capacity'));
    await scenario('missing worker acknowledgment is refused', '', () => denied(`update applications set terms_confirmed_worker_at=null where id='${app}'`, 'worker_confirmation_required'));
    await scenario('legacy farmer-only confirmation reserves capacity and is not rejected', '', () => denied(
      `update jobs set headcount=1;update applications set terms_confirmed_farmer_at=now(),terms_confirmed_worker_at=null where id='${sibling}'`, 'job_filled'));
    await scenario('completed historical hire still reserves capacity', '', () => denied(
      `update jobs set headcount=1;update applications set terms_confirmed_farmer_at=now(),status='completed' where id='${sibling}'`, 'job_filled'));
    await scenario('legacy farmer-only sibling keeps its record when last place closes',
      `update jobs set headcount=2;update applications set terms_confirmed_farmer_at=now(),terms_confirmed_worker_at=null where id='${sibling}'`, async () => {
        const before = (await state()).applications.find(a => a.id === sibling);
        await login(); const result = await rpc(); assert.equal(result.filled, true); assert.deepEqual(result.closed_ids, []);
        assert.deepEqual((await state()).applications.find(a => a.id === sibling), before);
      });
    await scenario('last place closes job and rejects only unconfirmed sibling', 'update jobs set headcount=1', async () => {
      await login(); const first = await rpc(); assert.equal(first.filled, true); assert.deepEqual(first.closed_ids, [sibling]);
      const before = await state(); assert.equal(before.jobs[0].status, 'closed');
      assert.equal(before.applications.find(a => a.id === sibling).status, 'rejected');
      await login(); const replay = await rpc(); assert.equal(replay.ok, true); assert.equal(replay.filled, false); assert.deepEqual(replay.closed_ids, []);
      assert.deepEqual(await state(), before);
    });
    for (const status of ['canceled','rejected','completed']) await scenario(`replay after ${status} remains no-write`, '', async () => {
      await login(); await rpc(); await db.exec(`reset role;update applications set status='${status}' where id='${app}';update jobs set status='closed'`);
      const before = await state(); await login(); assert.equal((await rpc()).ok, true); assert.deepEqual(await state(), before);
    });
    await scenario('partial historical replay never repairs snapshot or worker stamp',
      `update applications set terms_confirmed_farmer_at=now(),terms_confirmed_worker_at=null,status='canceled' where id='${app}';update jobs set status='closed'`, async () => {
        const before = await state(); await login(); const result = await rpc();
        assert.equal(result.ok, true); assert.equal(result.worker_confirmed, false); assert.deepEqual(await state(), before);
      });
    await scenario('suspended caller cannot replay', `update applications set terms_confirmed_farmer_at=now() where id='${app}'`,
      () => denied(`insert into account_moderation values('${farmer}','suspended')`, 'account_suspended'));
    await scenario('suspended target does not turn harmless replay into a write',
      `update applications set terms_confirmed_farmer_at=now() where id='${app}';insert into account_moderation values('${worker}','suspended')`, async () => {
        const before = await state(); await login(); assert.equal((await rpc()).ok, true); assert.deepEqual(await state(), before);
      });
    for (const [label, setup, reason] of [
      ['unknown dates', 'update jobs set date_start=null,date_end=null', 'work_dates_required'],
      ['all holidays', `update jobs set holidays='["2099-01-10","2099-01-11"]'`, 'work_dates_required'],
      ['past job dates', "update jobs set date_start='2000-01-01',date_end='2000-01-02'", 'work_expired'],
      ['past agreed dates', `update applications set agreed_dates='["2000-01-01"]' where id='${app}'`, 'work_expired'],
      ['single day after start', "update jobs set date_start=(clock_timestamp() at time zone 'Asia/Tokyo')::date,date_end=null,work_time='00:00〜23:59'", 'work_expired'],
    ]) await scenario(label, '', () => denied(setup, reason));
    await scenario('period job with future effective day remains eligible',
      `update jobs set date_start='2000-01-01';update applications set agreed_dates='["2099-01-11"]' where id='${app}'`, async () => {
        await login(); assert.equal((await rpc()).ok, true);
      });
    await scenario('double-booking warning and explicit acknowledgment are retained',
      `insert into jobs select 18,farmer_id,status,headcount,date_start,date_end,work_time,holidays,crop,task,lat,lng from jobs where job_number=17;
       insert into applications(id,worker_id,farmer_id,job_number,status,terms_confirmed_worker_at) values('${id(12)}','${worker}','${farmer}',18,'approved',now())`, async () => {
        const before = await state(); await login(); const warning = await rpc(); assert.equal(warning.reason, 'double_booked'); assert.equal(warning.dup_job, 18);
        assert.deepEqual(await state(), before); await login(); assert.equal((await rpc(true)).ok, true);
      });
  } finally { await db.close(); }
});
