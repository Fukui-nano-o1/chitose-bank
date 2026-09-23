import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JOB_DRAFT_FIELDS, jobDraftBase } from '../src/lib/offlineSync.js';
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.CB_TEST_NODE_MODULES ? `${process.env.CB_TEST_NODE_MODULES}/@electric-sql/pglite` : '@electric-sql/pglite');
const owner = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const jobId = '00000000-0000-4000-8000-000000000003';

test('real Postgres: own-row RLS, retry identity, stale edit rejection, open-job checks, and consent version checks', async () => {
  const db = new PGlite();
  try {
    const types = { headcount: 'integer', draft_step: 'integer', lat: 'numeric', lng: 'numeric', geo_radius_m: 'integer',
      date_start: 'date', date_end: 'date', holidays: 'jsonb', perks: 'jsonb', danger_places: 'jsonb', danger_tasks: 'jsonb', photos: 'jsonb',
      beginner_ok: 'boolean', instant_approve_repeat: 'boolean', experienced_preferred: 'boolean' };
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create table public.jobs(id uuid primary key, farmer_id uuid not null, job_number integer generated always as identity,
        status text default 'draft', ${JOB_DRAFT_FIELDS.map(k => `${k} ${types[k] || 'text'}`).join(',')});
      create table public.applications(job_number integer,status text);
      create table public.account_holders(auth_id uuid primary key,agreed_privacy_version text);
      create table public.app_settings(key text primary key,value text);
      create table public.consent_updates(auth_id uuid);
      create function public.count_consent_update() returns trigger language plpgsql security definer as $$ begin insert into public.consent_updates values(new.auth_id); return new; end $$;
      create trigger consent_updated after update on public.account_holders for each row execute function public.count_consent_update();
      insert into public.account_holders values('${owner}','old'),('${other}','current');
      insert into public.app_settings values('privacy_version','current');
      alter table public.app_settings enable row level security;
      alter table public.jobs enable row level security;
      create policy own_select on public.jobs for select to authenticated using(farmer_id=auth.uid());
      create policy own_insert on public.jobs for insert to authenticated with check(farmer_id=auth.uid() and status='draft');
      create policy own_update on public.jobs for update to authenticated using(farmer_id=auth.uid() and status in ('draft','pending')) with check(farmer_id=auth.uid() and status in ('draft','pending'));
      alter table public.account_holders enable row level security;
      create policy own_select on public.account_holders for select to authenticated using(auth_id=auth.uid());
      create policy own_update on public.account_holders for update to authenticated using(auth_id=auth.uid()) with check(auth_id=auth.uid());
      grant select,insert,update on public.jobs to authenticated;
      grant select,update on public.account_holders to authenticated;
      grant select on public.app_settings to authenticated;
      grant usage,select on all sequences in schema public to authenticated;
    `);
    // 公開中の更新は本番と同じ既存関数を通す（応募者の壁も検証する）。
    const openMigration = await readFile(new URL('../supabase/migrations/20260911010000_update_my_open_job.sql', import.meta.url), 'utf8');
    await db.exec(openMigration.slice(openMigration.indexOf('create or replace function public.update_my_open_job')));
    await db.exec(await readFile(new URL('../supabase/migrations/20260919114602_resumable_job_drafts.sql', import.meta.url), 'utf8'));
    // 2026-09-23 conflict に現在の行を添える（本番と同じ順で上書き適用）
    await db.exec(await readFile(new URL('../supabase/migrations/20260923070439_sync_conflict_returns_row.sql', import.meta.url), 'utf8'));
    const login = async uid => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]); await db.exec('set role authenticated'); };
    const call = async (name, expected, patch, id = jobId) => (await db.query(`select public.${name}($1,$2,$3,$4) as result`,[owner,id,expected,patch])).rows[0].result;
    const consent = async v => (await db.query('select public.save_my_privacy_consent($1,$2) as result',[owner,v])).rows[0].result;
    await login(owner);
    assert.equal((await call('sync_my_job_draft',null,{notes:'first'})).reason,'consent_required');
    assert.equal((await consent('current')).agreed_privacy_version,'current');
    await consent('current');
    const first = await call('sync_my_job_draft',null,{notes:'first'});
    assert.equal(first.ok,true);
    const retry = await call('sync_my_job_draft',null,{notes:'first'});
    assert.equal(retry.row.job_number,first.row.job_number);
    assert.equal((await db.query('select count(*)::int as n from public.jobs')).rows[0].n,1);
    const updated = await call('sync_my_job_draft',jobDraftBase(first.row),{notes:'second'});
    assert.equal(updated.ok,true);
    const stale = await call('sync_my_job_draft',jobDraftBase(first.row),{notes:'stale overwrite'});
    assert.equal(stale.reason,'conflict');
    assert.equal(stale.row.notes,'second'); // 衝突には本人の現在の行を添える＝端末が比較元を取り直せる
    assert.equal(stale.row.farmer_id,owner);
    const third = await call('sync_my_job_draft',jobDraftBase(updated.row),{notes:'third'});
    assert.equal(third.ok,true); // 取り直した比較元なら通る
    assert.equal((await call('sync_my_job_draft',jobDraftBase(third.row),{notes:'second'})).ok,true); // 同じ内容へ戻す（以降の検証の前提）
    const missing = await call('sync_my_job_draft',jobDraftBase(updated.row),{notes:'deleted elsewhere'},'00000000-0000-4000-8000-000000000098');
    assert.equal(missing.reason,'conflict'); assert.equal(missing.row,null); // 行が無い衝突は row:null＝新規に戻せる
    assert.equal((await call('sync_my_job_draft',jobDraftBase(first.row),{notes:'second'})).ok,true);
    assert.equal((await call('sync_my_job_draft',jobDraftBase(updated.row),{status:'open'})).reason,'bad_field');
    await login(other);
    await assert.rejects(consent('current'), /AUTH_REQUIRED/);
    assert.equal((await call('sync_my_job_draft',null,{notes:'wrong account new draft'}, '00000000-0000-4000-8000-000000000099')).ok,false);
    assert.equal((await db.query('select count(*)::int as n from public.jobs')).rows[0].n,0);
    assert.equal((await call('sync_my_job_draft',jobDraftBase(updated.row),{notes:'not yours'})).ok,false);
    assert.equal((await call('sync_my_open_job',jobDraftBase(updated.row),{notes:'not yours'})).ok,false);
    await db.exec(`reset role; update public.jobs set status='open' where id='${jobId}'`);
    await login(owner);
    const openRow = {...updated.row,status:'open'};
    const changed = await call('sync_my_open_job',jobDraftBase(openRow),{notes:'open edit'});
    assert.equal(changed.ok,true);
    const staleOpen = await call('sync_my_open_job',jobDraftBase(openRow),{notes:'stale open'});
    assert.equal(staleOpen.reason,'conflict'); assert.equal(staleOpen.row.status,'open'); assert.equal(staleOpen.row.notes,'open edit');
    const notOpen = await call('sync_my_job_draft',jobDraftBase(changed.row),{notes:'draft path on open job'});
    assert.equal(notOpen.reason,'conflict'); assert.equal(notOpen.row.status,'open'); // 掲載済みの行＝端末はそのまま掲載完了へ進める
    await db.exec(`reset role; insert into public.applications values(${changed.row.job_number},'applied')`);
    await login(owner);
    assert.equal((await call('sync_my_open_job',jobDraftBase(changed.row),{notes:'cannot edit with applicant'})).reason,'has_applications');
    await assert.rejects(consent('old'), /POLICY_CHANGED/);
    assert.equal((await db.query('select agreed_privacy_version from public.account_holders')).rows[0].agreed_privacy_version,'current');
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as n from public.consent_updates')).rows[0].n,1);
    await db.exec('set role anon');
    await assert.rejects(call('sync_my_job_draft',null,{notes:'anon'}), /permission denied/);
    await assert.rejects(call('sync_my_open_job',null,{notes:'anon'}), /permission denied/);
    await assert.rejects(consent('current'), /permission denied/);
  } finally { await db.close(); }
});
