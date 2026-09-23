import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createProductAnalytics, analyticsScreen, analyticsSource, ANALYTICS_CHOICE_KEY, CHOICE_TTL_MS, SESSION_IDLE_MS } from '../src/lib/productAnalytics.js';
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.CB_TEST_NODE_MODULES ? `${process.env.CB_TEST_NODE_MODULES}/@electric-sql/pglite` : '@electric-sql/pglite');
const id = n => `${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;

function fixture() {
  const saved = new Map(), calls = [], timers = new Map();
  let time = Date.parse('2026-09-23T10:00:00Z'), serial = 0, timerId = 0, hash = '#/search', broken = false;
  const storage = { getItem: key => saved.get(key) ?? null, removeItem: key => saved.delete(key), setItem: (key,value) => { if (broken) throw Error('storage unavailable'); saved.set(key,value); } };
  const tracker = createProductAnalytics({ storage: () => storage, now: () => time, makeId: () => id(++serial), getHash: () => hash,
    getSearch: () => '?src=private@example.test&token=secret', setTimer: fn => { timers.set(++timerId,fn); return timerId; }, clearTimer: n => timers.delete(n) });
  tracker.configure((rows,signal) => { calls.push({ rows, signal }); return new Promise(() => {}); });
  return { tracker, saved, calls, timers, advance: ms => time += ms, hash: value => hash = value, breakStorage: () => broken = true };
}

test('unknown/denied/expired consent sends nothing; opt-in starts now, strips identifiers, and rotation is bounded', () => {
  const f = fixture();
  f.tracker.page(); f.tracker.begin('apply')('success'); f.tracker.flush();
  assert.equal(f.calls.length,0);
  f.tracker.choose('denied'); f.tracker.page(); f.tracker.flush();
  assert.equal(f.calls.length,0);
  f.tracker.choose('granted'); f.tracker.flush();
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].rows[0].source,'other');
  const first = f.calls[0].rows[0].session_id;
  f.hash('#/work/job/1311?email=person@example.test&token=private'); f.tracker.page();
  f.tracker.begin('apply')('success'); f.tracker.flush();
  assert.equal(f.calls[1].rows[0].screen,'job');
  assert.equal(f.calls[1].rows[0].session_id,first);
  assert.doesNotMatch(JSON.stringify(f.calls),/person|example|1311|private|token|email/);
  f.advance(SESSION_IDLE_MS); f.tracker.page(); f.tracker.flush();
  assert.notEqual(f.calls[2].rows[0].session_id,first);
  f.advance(CHOICE_TTL_MS); f.tracker.begin('pdf')('failure'); f.tracker.flush();
  assert.equal(f.calls.length,3);
  assert.equal(f.tracker.choice(),null);
  for (const value of ['{}','broken','{"choice":"granted","version":"old"}']) {
    f.saved.set(ANALYTICS_CHOICE_KEY,value); f.tracker.page(); f.tracker.flush();
  }
  assert.equal(f.calls.length,3);
});

test('withdrawal and cross-tab changes discard pending data, abort sends, and never resurrect old operations', () => {
  const f = fixture(); f.tracker.choose('granted'); f.tracker.flush();
  const finish = f.tracker.begin('pdf');
  f.tracker.choose('denied');
  assert.ok(f.calls[0].signal.aborted);
  assert.equal(f.timers.size,0);
  finish('success'); f.tracker.flush(); assert.equal(f.calls.length,1);
  f.tracker.choose('granted'); finish('success'); f.tracker.flush();
  assert.deepEqual(f.calls[1].rows.map(row => row.event),['page_view']);
  f.tracker.begin('publish'); f.saved.clear(); f.tracker.refresh(); f.tracker.flush();
  assert.equal(f.calls.length,2);
  assert.ok(f.calls[1].signal.aborted);
});

test('storage failures fail closed even after an earlier grant; operator exclusion and repeated outcomes cannot inflate counts', () => {
  const f = fixture(); f.tracker.choose('granted');
  const end = f.tracker.begin('pdf'); f.advance(22000); end('failure'); end('success'); f.tracker.flush();
  assert.deepEqual(f.calls[0].rows.map(row => row.event),['page_view','pdf_start','pdf_failure']);
  assert.equal(f.calls[0].rows[2].duration_bucket,'over20s');
  f.breakStorage(); assert.equal(f.tracker.choose('denied'),false);
  f.tracker.page(); f.tracker.begin('pdf')('success'); f.tracker.flush();
  assert.equal(f.calls.length,1);
  assert.equal(f.tracker.choice(),'denied');
  const g = fixture(); g.tracker.choose('granted');
  g.tracker.configure(() => { throw Error('operator must not send'); },true);
  g.tracker.page(); g.tracker.begin('apply')('success'); g.tracker.flush();
  assert.equal(g.calls.length,0);
  assert.equal(analyticsScreen('#/admin/analytics'),null);
  assert.equal(analyticsScreen('#/profile/worker/schedule/private-id'),'schedule');
  assert.equal(analyticsSource('?src=insta'),'instagram');
});

test('real Postgres enforces fixed events, admin-only reads, append-only writes, aggregate outcomes and retention', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema cron;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;
      create table public.app_admins(auth_id uuid primary key); grant select on public.app_admins to authenticated;
      insert into public.app_admins values ('${id(99)}');
      create table public.page_events(id int); alter table public.page_events enable row level security;
      create policy "pe insert anon measure" on public.page_events for insert to anon with check(true);
      create table cron.fixture_jobs(name text, schedule text, command text);
      create function cron.schedule(text,text,text) returns bigint language sql as $$ insert into cron.fixture_jobs values($1,$2,$3) returning 1::bigint $$;`);
    await db.exec(await readFile(new URL('../supabase/migrations/20260923144717_optional_product_analytics.sql',import.meta.url),'utf8'));
    await db.exec("create table public.app_settings(key text primary key,value text); insert into public.app_settings values('privacy_version','v4.5-2026-08')");
    const privacyMigration = await readFile(new URL('../supabase/operations/activate_optional_analytics_privacy.sql',import.meta.url),'utf8');
    await db.exec(privacyMigration); await db.exec(privacyMigration);
    assert.equal((await db.query("select value from public.app_settings where key='privacy_version'")).rows[0].value,'v4.6-2026-09');
    await db.exec("update public.app_settings set value='future-version'");
    await assert.rejects(db.exec(privacyMigration),/Unexpected privacy version/);
    assert.equal((await db.query("select value from public.app_settings where key='privacy_version'")).rows[0].value,'future-version');

    const setRole = async (role, uid='') => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]); await db.exec(`set role ${role}`); };
    let seq = 0;
    const insert = (event='page_view', operation=null, bucket=null, version='2026-09-23') => db.query(`insert into public.product_events (session_id,sequence,event,screen,source,operation_id,duration_bucket,consent_version,consent_at) values ($1,$2,$3,'search','qr',$4,$5,$6,now())`,[id(1),++seq,event,operation,bucket,version]);
    await setRole('anon'); await insert();
    await assert.rejects(db.query('select * from public.product_events'),/permission denied/);
    await assert.rejects(insert('page_view',null,null,'old'),/check|row-level/);
    await assert.rejects(insert('private@example.test'),/check/);
    await assert.rejects(db.query(`insert into public.product_events (session_id,sequence,event,screen,source,consent_version,consent_at,created_at) values ($1,100,'page_view','search','qr','2026-09-23',now(),now()+interval '1 year')`,[id(1)]),/permission denied/);
    await assert.rejects(db.query('select public.admin_product_analytics(30)'),/permission denied/);
    await setRole('authenticated',id(2)); await insert('pdf_start',id(10)); await insert('pdf_success',id(10),'over20s');
    await insert('apply_start',id(11)); await insert('apply_failure',id(11),'1to5s'); await insert('publish_start',id(12));
    await assert.rejects(insert('pdf_failure',id(10),'lt1s'),/unique/);
    assert.deepEqual((await db.query('select * from public.product_events')).rows,[]);
    assert.equal((await db.query('select public.admin_product_analytics(30) as result')).rows[0].result,null);
    await assert.rejects(db.query('update public.product_events set source=\'other\''),/permission denied/);
    await assert.rejects(db.query('delete from public.product_events'),/permission denied/);
    await setRole('authenticated',id(99));
    const stats = (await db.query('select public.admin_product_analytics(30) as result')).rows[0].result;
    assert.equal(stats.sessions,1); assert.equal(stats.pages[0].views,1);
    assert.equal(stats.operations.find(row=>row.name==='pdf').succeeded,1);
    assert.equal(stats.operations.find(row=>row.name==='pdf').slow,1);
    assert.equal(stats.operations.find(row=>row.name==='apply').failed,1);
    assert.equal(stats.operations.find(row=>row.name==='publish').in_progress,1);
    await db.exec('reset role');
    await db.query("update public.product_events set created_at=now()-interval '40 minutes' where operation_id=$1",[id(12)]);
    await setRole('authenticated',id(99));
    assert.equal((await db.query('select public.admin_product_analytics(7) as result')).rows[0].result.operations.find(row=>row.name==='publish').unrecorded,1);
    await db.exec("reset role; update public.product_events set created_at=now()-interval '29 days 1 hour'");
    const job = (await db.query('select * from cron.fixture_jobs')).rows[0];
    assert.equal(job.schedule,'17 2 * * *'); await db.exec(job.command);
    assert.equal((await db.query('select count(*) from public.product_events')).rows[0].count,0);
    assert.equal((await db.query("select count(*) from pg_policies where tablename='page_events' and policyname='pe insert anon measure'")).rows[0].count,0);
  } finally { await db.close(); }
});
