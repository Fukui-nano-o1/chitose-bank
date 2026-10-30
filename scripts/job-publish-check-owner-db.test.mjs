import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), other = id(2), noJob = id(3), admin = id(4);
const read = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const patch = await read('20261030082026_guard_publication_check_owner.sql');
const policyFingerprint = `select md5(jsonb_agg(jsonb_build_array(policyname,permissive,roles,cmd,qual,with_check)
  order by policyname)::text) fingerprint from pg_policies where schemaname='public' and tablename='job_publish_checks'`;

// Synthetic local database only. Authorization is exercised under real SQL roles,
// not with a JavaScript substitute for the row-security predicates.
test('publication checks remain owned, append-only records without publishing jobs', async t => {
  const db = new PGlite();
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const login = async (actor = owner, role = 'authenticated') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor || '']);
    await db.exec(`set role ${role}`);
  };
  const insert = (number = 10, actor = owner, checkId = id(100)) =>
    db.query('insert into public.job_publish_checks(id,job_number,farmer_id,items) values($1,$2,$3,$4) returning *',
      [checkId, number, actor, JSON.stringify([{ text: 'Synthetic confirmation', checked: true }])]);
  const snapshot = async () => {
    await db.exec('reset role');
    return (await rows(`select jsonb_build_object(
      'jobs',(select jsonb_agg(to_jsonb(j) order by id) from public.jobs j),
      'checks',(select jsonb_agg(to_jsonb(c) order by id) from public.job_publish_checks c)) state`))[0].state;
  };
  const scenario = (name, fn) => t.test(name, async () => {
    await db.exec('reset role; begin');
    try { await fn(); } finally { await db.exec('rollback; reset role'); }
  });
  const rejected = async (run, code = '42501') => {
    await db.exec('savepoint rejected_write');
    await assert.rejects(run(), e => e.code === code);
    await db.exec('rollback to rejected_write');
  };
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated,service_role;
      create table public.jobs(id uuid primary key,job_number integer unique not null,farmer_id uuid not null,status text not null);
      alter table public.jobs enable row level security;
      create policy "jobs owner select" on public.jobs for select using(auth.uid()=farmer_id);
      grant select on public.jobs to authenticated,service_role;
      create table public.app_admins(auth_id uuid primary key);
      alter table public.app_admins enable row level security;
      grant select on public.app_admins to authenticated;
      create table public.account_moderation(auth_id uuid primary key,state text);
      create function public.is_account_moderated(p_uid uuid) returns boolean language sql stable security definer set search_path='public' as $$
        select exists(select 1 from public.account_moderation m where m.auth_id=p_uid and m.state in ('suspended','banned'))$$;
      create function public.assert_actor_not_moderated() returns trigger language plpgsql security definer set search_path='public' as $$
        begin if auth.uid() is not null and public.is_account_moderated(auth.uid()) then raise exception 'account suspended'; end if; return new; end$$;
    `);
    await db.exec(await read('20260716022759_app_admins_self_read.sql'));
    await db.exec(await read('20260731144258_job_publish_checks_record.sql'));
    await db.exec(await read('20260731144328_job_publish_checks_grants_tighten.sql'));
    await db.exec(`
      create trigger trg_a_block_moderated before insert or update on public.job_publish_checks
        for each row execute function public.assert_actor_not_moderated();
      grant all on public.job_publish_checks to service_role;
      insert into public.jobs values('${id(10)}',10,'${owner}','draft'),('${id(11)}',11,'${other}','draft'),('${id(12)}',12,'${admin}','draft');
      insert into public.app_admins values('${admin}');
    `);
    const unchangedCatalog = async () => (await rows(`select jsonb_build_object(
      'table',(select jsonb_build_array(relrowsecurity,relforcerowsecurity,relacl::text) from pg_class where oid='public.job_publish_checks'::regclass),
      'columns',(select jsonb_agg(jsonb_build_array(attname,atttypid,attnotnull,attacl::text) order by attnum) from pg_attribute where attrelid='public.job_publish_checks'::regclass and attnum>0),
      'constraints',(select jsonb_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid='public.job_publish_checks'::regclass),
      'triggers',(select jsonb_agg(jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid)) order by tgname) from pg_trigger where tgrelid='public.job_publish_checks'::regclass and not tgisinternal),
      'other_policies',(select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public' and (tablename<>'job_publish_checks' or policyname<>'jpc owner insert'))) value`))[0].value;
    assert.equal((await rows(policyFingerprint))[0].fingerprint, 'ffecd09f50c582295385658b9249598a');
    for (const number of [10, 11, 99999, -1]) {
      await scenario(`baseline/owned-any-job accepts target ${number} without publishing`, async () => {
        const before = await snapshot();
        await login();
        assert.equal((await insert(number)).rows.length, 1);
        assert.deepEqual((await snapshot()).jobs, before.jobs);
      });
    }
    const beforeCatalog = await unchangedCatalog();
    await db.exec(patch);
    assert.deepEqual(await unchangedCatalog(), beforeCatalog);
    const newPolicy = (await rows("select with_check from pg_policies where schemaname='public' and tablename='job_publish_checks' and policyname='jpc owner insert'"))[0].with_check;
    assert.match(newPolicy, /j\.job_number = job_publish_checks\.job_number/);
    assert.doesNotMatch(newPolicy, /j\.job_number = j\.job_number/);
    for (const [actor, role, number, farmer, label] of [
      [owner, 'authenticated', 11, owner, 'other-job'],
      [owner, 'authenticated', 99999, owner, 'missing-job'],
      [owner, 'authenticated', -1, owner, 'invalid-number'],
      [owner, 'authenticated', 10, other, 'forged-farmer'],
      [noJob, 'authenticated', 10, noJob, 'no-owned-job'],
      [other, 'authenticated', 10, other, 'unrelated-owner'],
      [admin, 'authenticated', 10, admin, 'admin-is-not-owner'],
      ['', 'authenticated', 10, owner, 'missing-subject'],
      ['', 'anon', 10, owner, 'anonymous'],
    ]) await scenario(`patched/insert-denied/${label}`, async () => {
      const before = await snapshot();
      await login(actor, role);
      await rejected(() => insert(number, farmer));
      assert.deepEqual(await snapshot(), before);
    });
    for (const [actor, number, role, label] of [
      [owner, 10, 'authenticated', 'owner'],
      [other, 11, 'authenticated', 'other-owner'],
      [admin, 12, 'authenticated', 'admin-own-job'],
      ['', 99999, 'service_role', 'trusted-service-bypass-unchanged'],
    ]) await scenario(`patched/insert-allowed/${label}`, async () => {
      const before = await snapshot();
      await login(actor, role);
      const inserted = (await insert(number, actor || owner)).rows[0];
      assert.equal(inserted.job_number, number);
      await rejected(() => insert(number, actor || owner), '23505');
      assert.deepEqual((await snapshot()).jobs, before.jobs);
      assert.equal((await snapshot()).checks.length, (before.checks?.length || 0) + 1);
    });
    await scenario('patched/default farmer_id remains the authenticated owner', async () => {
      await login();
      const inserted = (await rows("insert into public.job_publish_checks(job_number,items) values(10,'[]') returning farmer_id"))[0];
      assert.equal(inserted.farmer_id, owner);
      await rejected(() => rows("insert into public.job_publish_checks(job_number,items) values(11,'[]')"));
    });
    await db.exec(`insert into public.job_publish_checks(id,job_number,farmer_id,items) values
      ('${id(200)}',10,'${owner}','[]'),('${id(201)}',11,'${other}','[]')`);
    for (const [actor, role, expected, label] of [
      [owner, 'authenticated', [10], 'owner'], [other, 'authenticated', [11], 'other-owner'],
      [noJob, 'authenticated', [], 'unrelated'], [admin, 'authenticated', [10, 11], 'admin'],
      ['', 'authenticated', [], 'missing-subject'], ['', 'service_role', [10, 11], 'service'],
    ]) await scenario(`patched/read/${label}`, async () => {
      await login(actor, role);
      assert.deepEqual((await rows('select job_number from public.job_publish_checks order by job_number')).map(r => r.job_number), expected);
    });
    await scenario('patched/read/anonymous', async () => {
      await login('', 'anon');
      await rejected(() => rows('select * from public.job_publish_checks'));
    });
    for (const [actor, role, code, label] of [
      [owner, 'authenticated', '42501', 'owner'], [other, 'authenticated', '42501', 'other'],
      [admin, 'authenticated', '42501', 'admin'], ['', 'anon', '42501', 'anon'],
      ['', 'service_role', 'P0001', 'service'], ['', 'postgres', 'P0001', 'postgres'],
    ]) for (const operation of ['update', 'delete']) await scenario(`patched/append-only/${label}/${operation}`, async () => {
      const before = await snapshot();
      await login(actor, role);
      await rejected(() => rows(operation === 'update'
        ? "update public.job_publish_checks set job_number=11 where job_number=10"
        : 'delete from public.job_publish_checks where job_number=10'), code);
      assert.deepEqual(await snapshot(), before);
    });
    await scenario('patched/multi-row insertion is atomic', async () => {
      const before = await snapshot(); await login();
      await rejected(() => rows(`insert into public.job_publish_checks(job_number,farmer_id,items)
        values(10,'${owner}','[]'),(11,'${owner}','[]')`));
      assert.deepEqual(await snapshot(), before);
    });
    await scenario('patched/moderation still rejects the owner', async () => {
      await db.exec(`insert into public.account_moderation values('${owner}','suspended')`);
      const before = await snapshot(); await login();
      await rejected(() => insert(), 'P0001');
      assert.deepEqual(await snapshot(), before);
    });
    // The action-time guard must fail closed on a second application or policy drift.
    await assert.rejects(db.exec(patch), /PUBLICATION_CHECK_POLICY_DRIFT/);
    await db.exec('rollback; reset role');
  } finally { await db.close(); }
});
