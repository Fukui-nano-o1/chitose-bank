import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {JOB_DRAFT_FIELDS,jobDraftBase} from '../src/lib/jobDraftProtocol.js';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.CB_TEST_NODE_MODULES ? `${process.env.CB_TEST_NODE_MODULES}/@electric-sql/pglite` : '@electric-sql/pglite');
const owner='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002';
const items=[{text:'表示した掲載条件を確認しました',checked:true}];

test('Postgres: publication and confirmation are one atomic, owned, replayable operation',async t=>{
  const db=new PGlite();
  try {
    const types={headcount:'integer',draft_step:'integer',lat:'numeric',lng:'numeric',geo_radius_m:'integer',
      date_start:'date',date_end:'date',holidays:'jsonb',perks:'jsonb',danger_places:'jsonb',danger_tasks:'jsonb',photos:'jsonb',
      beginner_ok:'boolean',instant_approve_repeat:'boolean',experienced_preferred:'boolean',
      work_video_job_consent:'boolean',work_video_related_consent:'boolean',work_video_consent_at:'timestamptz'};
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated;
      create table public.jobs(id uuid primary key,farmer_id uuid not null,job_number integer generated always as identity,
        status text default 'draft',revision_requested_at timestamptz,draft_step_id text,
        ${JOB_DRAFT_FIELDS.map(k=>`${k} ${types[k]||'text'}`).join(',')});
      alter table public.jobs enable row level security;
      create policy own_read on public.jobs for select to authenticated using(farmer_id=auth.uid());
      grant select on public.jobs to authenticated;
      create table public.app_admins(auth_id uuid primary key);
      grant select on public.app_admins to authenticated;
      create table public.account_holders(auth_id uuid primary key,agreed_privacy_version text);
      insert into public.account_holders values('${owner}','current'),('${other}','current');
      create function public.current_privacy_version() returns text language sql as $$ select 'current'::text $$;
      create function public.is_account_moderated(uuid) returns boolean language sql as $$ select coalesce(current_setting('qa.moderated',true),'')='yes' $$;
      create table public.qa_effects(kind text);
      create function public.notify_admins(text,text) returns void language sql as $$ insert into public.qa_effects values('notification') $$;
      create function public.send_admin_email(text,text) returns void language sql as $$ insert into public.qa_effects values('email_enqueue') $$;
      create function public.qa_job_update() returns trigger language plpgsql as $$ begin
        if current_setting('qa.reject_publish',true)='yes' then raise exception 'publication validation rejected'; end if;
        insert into public.qa_effects values('job_update'); return new;
      end $$;
      create trigger qa_job_update after update on public.jobs for each row execute function public.qa_job_update();
    `);
    for (const file of ['20260814093042_revision_requested_jobs_need_admin_open.sql',
      '20260731144258_job_publish_checks_record.sql','20261016124849_atomic_job_publish_check.sql']) {
      if (file === '20261016124849_atomic_job_publish_check.sql') {
        await db.exec(await readFile(new URL('./fixtures/job-save-prod-functions-20261018.sql', import.meta.url), 'utf8'));
      }
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
    }
    await db.exec(`
      create function public.qa_insert_failure() returns trigger language plpgsql as $$ begin
        if current_setting('qa.fail_'||TG_ARGV[0],true)='yes' then raise exception 'injected insert failure'; end if;
        return new;
      end $$;
      create trigger qa_fail_check before insert on public.job_publish_checks for each row execute function public.qa_insert_failure('check');
      create trigger qa_fail_request before insert on private.job_publication_requests for each row execute function public.qa_insert_failure('request');
    `);
    const login=async(uid=owner)=>{
      await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]); await db.exec('set role authenticated');
    };
    const admin=async(sql,params=[])=>{await db.exec('reset role');try{return await db.query(sql,params);}finally{await login();}};
    const setting=async(key,value)=>db.query('select set_config($1,$2,false)',[`qa.${key}`,value]);
    const seed=async(extra={})=>{
      const row=(await admin(`insert into public.jobs(id,farmer_id,notes,photos,revision_requested_at,status,work_video_consent_at)
        values($1,$2,'confirmed input','["one","two"]',$3,$4,$5) returning *`,
        [crypto.randomUUID(),owner,extra.revision||null,extra.status||'draft',extra.timestamp||null])).rows[0];
      // PostgreSQL driver date objects are normalized like PostgREST's JSON row.
      return (await db.query('select to_jsonb(j) as row from public.jobs j where id=$1',[row.id])).rows[0].row;
    };
    const request=row=>({id:crypto.randomUUID(),job:row.id,expected:jobDraftBase(row),items,at:'2026-10-16T12:00:00.123Z'});
    const call=async r=>(await db.query('select public.publish_my_job_with_check($1,$2,$3,$4,$5) as result',
      [r.id,r.job,r.expected,JSON.stringify(r.items),r.at])).rows[0].result;
    const counts=async()=> (await admin(`select (select count(*)::int from public.job_publish_checks) checks,
      (select count(*)::int from private.job_publication_requests) requests,(select count(*)::int from public.qa_effects) effects`)).rows[0];

    await t.test('snapshot contract and function/table permissions',async()=>{
      const source=await readFile(new URL('../supabase/migrations/20261016124849_atomic_job_publish_check.sql',import.meta.url),'utf8');
      const fields=[...source.match(/v_fields text\[\] := array\[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
      assert.deepEqual(new Set(fields),new Set([...JOB_DRAFT_FIELDS,'draft_step_id','status']));
      const security=(await db.query(`select proname,prosecdef,proconfig from pg_proc where proname in ('publish_job_with_check','publish_my_job_with_check') order by proname`)).rows;
      assert.equal(security[0].prosecdef,true); assert.ok(security[0].proconfig.includes('TimeZone=UTC'));
      assert.equal(security[1].prosecdef,false);
      await login();
      await assert.rejects(db.query('select * from private.job_publication_requests'),/permission denied/);
      await assert.rejects(db.query('select public.publish_my_job(1)'),/permission denied/);
      await db.exec('set role anon');
      await assert.rejects(call({id:crypto.randomUUID(),job:crypto.randomUUID(),expected:{},items,at:'2026-10-16T12:00Z'}),/permission denied/);
      await login('');
      assert.equal((await call({id:crypto.randomUUID(),job:crypto.randomUUID(),expected:{},items,at:'2026-10-16T12:00Z'})).reason,'not_logged_in');
      await login();
    });
    for (const failure of ['check','request']) {
      await t.test(`${failure} insert failure rolls back job, receipt, request and transaction-side effects`,async()=>{
        const row=await seed({revision:'2026-10-15T00:00:00Z'}), req=request(row), before=await counts();
        await setting(`fail_${failure}`,'yes');
        const rejected=await call(req);
        assert.equal(rejected.ok,false); assert.equal(rejected.reason,'publication_rejected'); assert.equal(rejected.code,'P0001');
        assert.deepEqual(await counts(),before);
        assert.equal((await db.query('select status from public.jobs where id=$1',[row.id])).rows[0].status,'draft');
        await setting(`fail_${failure}`,'no');
        const success=await call(req);
        assert.equal(success.ok,true); assert.equal(success.pending,true); assert.equal(success.row.status,'pending');
        assert.deepEqual(await counts(),{checks:before.checks+1,requests:before.requests+1,effects:before.effects+3});
        assert.deepEqual(await call(req),success); // no second update, notification or email enqueue
        assert.deepEqual(await counts(),{checks:before.checks+1,requests:before.requests+1,effects:before.effects+3});
      });
    }
    await t.test('publication validation still rejects without any receipt',async()=>{
      const req=request(await seed()),before=await counts();
      await setting('reject_publish','yes');
      assert.equal((await call(req)).reason,'publication_rejected');
      assert.deepEqual(await counts(),before);
      await setting('reject_publish','no');
    });
    await t.test('lost response replay returns the same immutable receipt in three DB timezones',async()=>{
      const req=request(await seed({timestamp:'2026-10-16T00:00:00.123456Z'})), before=await counts();
      const first=await call(req);
      assert.equal(first.ok,true); assert.equal(first.row.status,'open'); assert.equal(first.check_id,req.id);
      for (const zone of ['UTC','Asia/Tokyo','America/Sao_Paulo']) {
        await db.query("select set_config('TimeZone',$1,false)",[zone]);
        const equivalent={...req,expected:{...req.expected,work_video_consent_at:'2026-10-16T09:00:00.123456+09:00'},at:'2026-10-16T21:00:00.123+09:00'};
        assert.deepEqual(await call(equivalent),first);
      }
      assert.deepEqual(await counts(),{checks:before.checks+1,requests:before.requests+1,effects:before.effects+1});
      const receipt=(await db.query('select * from public.job_publish_checks where id=$1',[req.id])).rows[0];
      assert.deepEqual(receipt.items,items); assert.equal(receipt.farmer_id,owner); assert.equal(new Date(receipt.agreed_at).toISOString(),req.at);
      await db.exec('reset role');
      await assert.rejects(db.query('update public.job_publish_checks set items=items where id=$1',[req.id]),/append-only/);
      await assert.rejects(db.query('delete from public.job_publish_checks where id=$1',[req.id]),/append-only/);
      await login();
      assert.equal((await call({...req,items:[{text:'changed',checked:true}]})).reason,'request_mismatch');
      assert.equal((await call({...req,expected:{...req.expected,notes:'changed'}})).reason,'request_mismatch');
      assert.equal((await call({...req,at:'2026-10-16T12:00:01Z'})).reason,'request_mismatch');
      await admin("update public.jobs set notes='later remote edit' where id=$1",[req.job]);
      const later=await call(req);
      assert.equal(later.row.notes,'later remote edit'); assert.equal(later.published_base.notes,'confirmed input');
      await admin("update public.jobs set status='closed' where id=$1",[req.job]);
      const closed=await call(req);
      assert.equal(closed.ok,true); assert.equal(closed.row.status,'closed'); assert.equal(closed.check_id,first.check_id);
      await login(other);
      assert.equal((await call(req)).reason,'not_found');
      assert.equal((await db.query('select count(*)::int n from public.job_publish_checks')).rows[0].n,0);
      await login();
    });
    await t.test('two devices: first publication wins; stale or competing operation cannot republish',async()=>{
      const row=await seed(), a=request(row), b=request(row), before=await counts();
      assert.equal((await call(a)).ok,true);
      assert.equal((await call(b)).reason,'bad_status');
      assert.deepEqual(await counts(),{checks:before.checks+1,requests:before.requests+1,effects:before.effects+1});
      const edited=await seed(), stale=request(edited);
      await admin("update public.jobs set notes='other device' where id=$1",[edited.id]);
      const conflict=await call(stale);
      assert.equal(conflict.reason,'conflict'); assert.equal(conflict.row.notes,'other device');
      assert.equal(conflict.row.status,'draft');
    });
    await t.test('exact input snapshot, consent, moderation and checked items are mandatory',async()=>{
      const row=await seed(), req=request(row),before=await counts();
      for (const expected of [{}, {...req.expected,photos:['one']}, {...req.expected,extra:true}]) {
        assert.equal((await call({...req,expected})).reason,'conflict');
      }
      for (const invalid of [null,{},[],[{text:'valid',checked:false}],[{text:'',checked:true}],[{checked:true}],Array(21).fill(items[0])]) {
        assert.equal((await call({...req,items:invalid})).reason,'bad_confirmation');
      }
      for (const at of [null,'infinity']) assert.equal((await call({...req,at})).reason,'bad_confirmation');
      await setting('moderated','yes');
      assert.equal((await call(req)).reason,'account_suspended');
      await setting('moderated','no');
      await admin("update public.account_holders set agreed_privacy_version='old' where auth_id=$1",[owner]);
      assert.equal((await call(req)).reason,'consent_required');
      await admin("update public.account_holders set agreed_privacy_version='current' where auth_id=$1",[owner]);
      assert.deepEqual(await counts(),before);
    });
  } finally { await db.close(); }
});
