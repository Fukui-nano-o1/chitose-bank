import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JOB_DRAFT_FIELDS, jobDraftBase, syncDeviceWork } from '../src/lib/offlineSync.js';
import { newDeviceDraft, saveDeviceDraft, readDeviceDraft, queueDeviceDraft } from '../src/lib/deviceDrafts.js';
import {jobDraftPatch} from '../src/lib/jobDraftProtocol.js';
import {jobFormFromRow, jobPayloadFromForm} from '../src/features/jobs/create/jobInputCodec.js';
import {jobInputSample, jobInputOptions} from './fixtures/job-input.js';
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.CB_TEST_NODE_MODULES ? `${process.env.CB_TEST_NODE_MODULES}/@electric-sql/pglite` : '@electric-sql/pglite');
const owner = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const jobId = '00000000-0000-4000-8000-000000000003';

test('real Postgres: own-row RLS, retry identity, stale edit rejection, open-job checks, and consent version checks', async t => {
  const db = new PGlite();
  try {
    const types = { headcount: 'integer', draft_step: 'integer', lat: 'numeric', lng: 'numeric', geo_radius_m: 'integer',
      date_start: 'date', date_end: 'date', holidays: 'jsonb', perks: 'jsonb', danger_places: 'jsonb', danger_tasks: 'jsonb', photos: 'jsonb',
      beginner_ok: 'boolean', instant_approve_repeat: 'boolean', experienced_preferred: 'boolean',
      work_video_job_consent: 'boolean', work_video_related_consent: 'boolean', work_video_consent_at: 'timestamptz' };
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
    // 2026-10-05 作業動画列を同期許可リストへ追加（本番適用済みmigration）。
    await db.exec(await readFile(new URL('../supabase/migrations/20261005050122_allow_job_work_video_in_sync.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('./fixtures/current-draft-sync-contract.sql', import.meta.url), 'utf8'));
    // Release preflight: exercise the definitions actually read from production before patching.
    await db.exec(await readFile(new URL('./fixtures/job-save-prod-functions-20261018.sql', import.meta.url), 'utf8'));
    const functionSecurity = async () => (await db.query(`select proname,prosecdef,proconfig,proacl::text from pg_proc
      where oid in ('public.sync_my_job_draft(uuid,uuid,jsonb,jsonb)'::regprocedure,
      'public.sync_my_open_job(uuid,uuid,jsonb,jsonb)'::regprocedure) order by proname`)).rows;
    const beforeSecurity = await functionSecurity();
    const equalityMigration = await readFile(new URL('../supabase/migrations/20261018142041_job_sync_value_equality.sql', import.meta.url), 'utf8');
    await t.test('migration stops on unexpected definitions and leaves both functions unchanged',async()=>{
      const definitions=async()=>(await db.query(`select pg_get_functiondef(oid) as definition from pg_proc
        where oid in ('public.sync_my_job_draft(uuid,uuid,jsonb,jsonb)'::regprocedure,
        'public.sync_my_open_job(uuid,uuid,jsonb,jsonb)'::regprocedure) order by proname`)).rows.map(r=>r.definition);
      const originals=await definitions();
      const drift=originals[1].replace("to_jsonb(v_job) @> (p_patch - 'draft_step')","to_jsonb(v_job) @> ((p_patch - 'draft_step'))");
      assert.notEqual(drift,originals[1]);
      await db.exec(drift);
      const before=await definitions();
      await assert.rejects(db.exec(equalityMigration),/anchor count/);
      assert.deepEqual(await definitions(),before);
      await db.exec(originals[1]);
    });
    await db.exec(equalityMigration);
    await db.exec(equalityMigration); // 再実行しても二重挿入しない。
    assert.deepEqual(await functionSecurity(),beforeSecurity); // EXECUTE・definer/invoker・search_pathを維持。
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
    // 本番と同じ比較契約で、欠落列が偽の競合を起こすことと修正を直接検証する。
    assert.equal(Object.hasOwn(first.row,'draft_step_id'),true);
    for (const name of ['sync_my_job_draft','sync_my_open_job']) {
      const def = (await db.query('select pg_get_functiondef(($1)::regprocedure) as definition', [`public.${name}(uuid,uuid,jsonb,jsonb)`])).rows[0].definition;
      assert.match(def, /'draft_step_id'/);
      const allowed = [...def.match(/v_allowed text\[\] := array\[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
      assert.deepEqual(new Set(allowed),new Set([...JOB_DRAFT_FIELDS,'draft_step_id']));
    }
    const legacyBase = jobDraftBase(first.row); delete legacyBase.draft_step_id;
    const falseConflict = await call('sync_my_job_draft',legacyBase,{notes:'second'});
    assert.equal(falseConflict.reason,'conflict');
    assert.equal(falseConflict.row.notes,'first');
    const updated = await call('sync_my_job_draft',jobDraftBase(first.row),{notes:'second'});
    assert.equal(updated.ok,true);
    for (let attempt=0; attempt<5; attempt++) {
      const duplicate = await call('sync_my_job_draft',jobDraftBase(first.row),{notes:'second'});
      assert.equal(duplicate.ok,true); assert.equal(duplicate.row.id,jobId);
    }
    assert.equal((await db.query('select count(*)::int as n from public.jobs')).rows[0].n,1);

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
    // codecの44項目をSQLのjsonb_populate_recordまで通す。所有者・公開状態はpatch外。
    const input=jobInputSample();
    const patch=jobDraftPatch(jobPayloadFromForm(jobFormFromRow(input,jobInputOptions),{ownerId:owner,status:'draft',base:input,now:new Date(2026,9,16)}));
    const allId='00000000-0000-4000-8000-000000000044';
    const allSaved=await call('sync_my_job_draft',null,patch,allId);
    assert.equal(allSaved.ok,true);
    for (const field of JOB_DRAFT_FIELDS) {
      if (field === 'work_video_consent_at') assert.equal(Date.parse(allSaved.row[field]),Date.parse(input[field]),field);
      else assert.deepEqual(allSaved.row[field],input[field],field);
    }
    await t.test('video consent timestamp survives an identical retry after a lost response', async () => {
      const allRetry=await call('sync_my_job_draft',null,patch,allId);
      assert.equal(allRetry.ok,true); assert.equal(allRetry.row.job_number,allSaved.row.job_number);
    });

    for (const status of ['draft','open']) {
      await t.test(`${status}: array removal and ordering are writes, not already-saved acknowledgements`, async () => {
        const id=crypto.randomUUID();
        let saved=await call('sync_my_job_draft',null,{photos:['a','b']},id);
        if (status==='open') {
          await db.exec(`reset role; update public.jobs set status='open' where id='${id}'`);
          await login(owner); saved.row.status='open';
        }
        const name=status==='draft'?'sync_my_job_draft':'sync_my_open_job';
        const original=jobDraftBase(saved.row);
        const reordered=await call(name,original,{photos:['b','a']},id);
        assert.equal(reordered.ok,true); assert.deepEqual(reordered.row.photos,['b','a']);
        const stale=await call(name,original,{photos:[]},id);
        assert.equal(stale.reason,'conflict'); assert.deepEqual(stale.row.photos,['b','a']);
        const removed=await call(name,jobDraftBase(reordered.row),{photos:[]},id);
        assert.equal(removed.ok,true); assert.deepEqual(removed.row.photos,[]);
        const retry=await call(name,jobDraftBase(reordered.row),{photos:[]},id);
        assert.equal(retry.ok,true); assert.deepEqual(retry.row.photos,[]);
      });
    }

    for (const zone of ['UTC','Asia/Tokyo','America/Sao_Paulo']) {
      for (const status of ['draft','open']) {
        await t.test(`${zone}/${status}: timestamp retries, equivalent snapshots and true microsecond conflicts`, async () => {
          await db.query("select set_config('TimeZone',$1,false)",[zone]);
          const id=crypto.randomUUID();
          const timestamp='2026-10-16T00:00:00.123456Z';
          const video={notes:'video',work_video_url:'https://www.youtube.com/watch?v=abcdefghijk',
            work_video_job_consent:true,work_video_related_consent:false,
            work_video_consent_version:'test-v1',work_video_consent_at:timestamp};
          let saved=await call('sync_my_job_draft',null,video,id);
          assert.equal(saved.ok,true);
          if (status==='open') {
            await db.exec(`reset role; update public.jobs set status='open' where id='${id}'`);
            await login(owner); saved.row.status='open';
          }
          const name=status==='draft'?'sync_my_job_draft':'sync_my_open_job';
          for (const equivalent of [timestamp,'2026-10-16T09:00:00.123456+09:00','2026-10-15T21:00:00.123456-03:00']) {
            const retry=await call(name,null,{...video,work_video_consent_at:equivalent},id);
            assert.equal(retry.ok,true); assert.equal(retry.row.job_number,saved.row.job_number);
          }
          assert.equal((await db.query('select count(*)::int n from public.jobs where id=$1',[id])).rows[0].n,1);
          const base={...jobDraftBase(saved.row),work_video_consent_at:timestamp};
          const edited=await call(name,base,{notes:'edited'},id);
          assert.equal(edited.ok,true); assert.equal(edited.row.notes,'edited');
          const lostUpdate=await call(name,base,{notes:'edited',work_video_consent_at:timestamp},id);
          assert.equal(lostUpdate.ok,true);
          const changed=await call(name,jobDraftBase(edited.row),{work_video_consent_at:'2026-10-16T00:00:00.123457Z'},id);
          assert.equal(changed.ok,true);
          const stale=await call(name,jobDraftBase(edited.row),{notes:'stale',work_video_consent_at:timestamp},id);
          assert.equal(stale.reason,'conflict'); assert.equal(stale.row.notes,'edited');
          assert.match(stale.row.work_video_consent_at,/\.123457/);
          await assert.rejects(call(name,jobDraftBase(changed.row),{work_video_consent_at:'not-a-date'},id),/invalid input syntax/);
          const cleared=await call(name,jobDraftBase(changed.row),{work_video_url:null,work_video_consent_at:null},id);
          assert.equal(cleared.ok,true); assert.equal(cleared.row.work_video_consent_at,null);
          const clearRetry=await call(name,jobDraftBase(changed.row),{work_video_url:null,work_video_consent_at:null},id);
          assert.equal(clearRetry.ok,true);
        });
      }
    }

    for (const field of ['photos','holidays','perks','danger_places','danger_tasks']) {
      for (const status of ['draft','open']) {
        await t.test(`${status}/${field}: partial, empty and duplicate array changes are stored exactly`, async () => {
          const id=crypto.randomUUID();
          let saved=await call('sync_my_job_draft',null,{[field]:[{label:'a',url:'a'},{label:'b',url:'b'}]},id);
          assert.equal(saved.ok,true);
          if (status==='open') {
            await db.exec(`reset role; update public.jobs set status='open' where id='${id}'`);
            await login(owner); saved.row.status='open';
          }
          const name=status==='draft'?'sync_my_job_draft':'sync_my_open_job';
          for (const desired of [[{url:'a'}],[{url:'a'},{url:'a'}],[{url:'a'}],[]]) {
            const expected=jobDraftBase(saved.row);
            const stale={...expected,notes:'unknown remote state'};
            assert.equal((await call(name,stale,{[field]:desired},id)).reason,'conflict');
            saved=await call(name,expected,{[field]:desired},id);
            assert.equal(saved.ok,true); assert.deepEqual(saved.row[field],desired);
            const stored=(await db.query(`select ${field} as value from public.jobs where id=$1`,[id])).rows[0].value;
            assert.deepEqual(stored,desired);
          }
        });
      }
    }

    await t.test('device queue + real SQL: lost response retries one ID; a second device cannot overwrite a newer edit', async () => {
      const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
      const makeStorage=() => {
        const data={};
        Object.defineProperties(data,{
          getItem:{value:key=>data[key]??null},
          setItem:{value:(key,value)=>{data[key]=String(value);}},
          removeItem:{value:key=>{delete data[key];}},
        });
        return data;
      };
      const deviceA=makeStorage(),deviceB=makeStorage();
      const useDevice=value=>Object.defineProperty(globalThis,'localStorage',{value,configurable:true});
      let loseResponse=true;
      const requests=[];
      const client={
        auth:{getSession:async()=>({data:{session:{user:{id:owner}}}})},
        from:()=>({select:()=>({eq:()=>({maybeSingle:()=>({retry:async()=>({data:{agreed_privacy_version:'current'}})})})})}),
        rpc:(name,args)=>({retry:async()=>{
          requests.push(structuredClone(args));
          const result=await call(name,args.p_expected,args.p_patch,args.p_id);
          if (loseResponse) {loseResponse=false; throw new TypeError('network error: saved response lost');}
          return {data:result};
        }}),
      };
      try {
        await db.query("select set_config('TimeZone','Asia/Tokyo',false)");
        useDevice(deviceA);
        const payload={notes:'original',photos:['a','b'],work_video_consent_at:'2026-10-16T00:00:00Z'};
        const a=saveDeviceDraft(newDeviceDraft(owner),{jobDescription:'original'},payload);
        queueDeviceDraft(owner,a.id);
        await syncDeviceWork(client,owner,'current');
        assert.equal(readDeviceDraft(owner,a.id).state,'pending');
        assert.equal((await db.query('select count(*)::int n from public.jobs where id=$1',[a.jobId])).rows[0].n,1);
        await syncDeviceWork(client,owner,'current');
        const confirmed=readDeviceDraft(owner,a.id);
        assert.equal(confirmed.state,'synced');
        assert.equal(requests.length,2); assert.deepEqual(requests[0],requests[1]);
        useDevice(deviceB);
        const b=saveDeviceDraft(newDeviceDraft(owner,confirmed.base),{jobDescription:'device B'}, {...payload,notes:'device B'});
        useDevice(deviceA);
        const editedA=saveDeviceDraft(confirmed,{jobDescription:'device A'},{...payload,notes:'device A'});
        queueDeviceDraft(owner,editedA.id); await syncDeviceWork(client,owner,'current');
        assert.equal(readDeviceDraft(owner,a.id).state,'synced');
        useDevice(deviceB);
        queueDeviceDraft(owner,b.id); await syncDeviceWork(client,owner,'current');
        const conflicted=readDeviceDraft(owner,b.id);
        assert.equal(conflicted.state,'conflict'); assert.equal(conflicted.form.jobDescription,'device B');
        assert.equal(conflicted.conflictContext.remote.notes,'device A');
        assert.equal(queueDeviceDraft(owner,b.id).state,'conflict');
        const count=requests.length; await syncDeviceWork(client,owner,'current');
        assert.equal(requests.length,count);
        assert.equal((await db.query('select notes from public.jobs where id=$1',[a.jobId])).rows[0].notes,'device A');
      } finally {
        if (previousStorage) Object.defineProperty(globalThis,'localStorage',previousStorage);
        else delete globalThis.localStorage;
      }
    });
    const allUpdate=await call('sync_my_job_draft',jobDraftBase(allSaved.row),{...patch,notes:'',beginner_ok:false,photos:[]},allId);
    assert.equal(allUpdate.ok,true); assert.equal(allUpdate.row.notes,''); assert.equal(allUpdate.row.beginner_ok,false); assert.deepEqual(allUpdate.row.photos,[]);
    const allConflict=await call('sync_my_job_draft',jobDraftBase(allSaved.row),{...patch,notes:'別端末の古い入力'},allId);
    assert.equal(allConflict.reason,'conflict'); assert.equal(allConflict.row.notes,'');
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
