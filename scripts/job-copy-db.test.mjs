import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {JOB_COPY_POLICY,JOB_DRAFT_FIELDS} from '../src/lib/jobInputFields.js';
import {jobInputSample} from './fixtures/job-input.js';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const sql=async file=>readFile(new URL(file,import.meta.url),'utf8');
test('copy preserves all input, resets dates and requires fresh video consent',async t=>{
  const db=new PGlite();
  try {
    const types={headcount:'integer',draft_step:'integer',lat:'numeric',lng:'numeric',geo_radius_m:'integer',date_start:'date',date_end:'date',
      holidays:'jsonb',perks:'jsonb',danger_places:'jsonb',danger_tasks:'jsonb',photos:'jsonb',beginner_ok:'boolean',instant_approve_repeat:'boolean',experienced_preferred:'boolean',
      work_video_job_consent:'boolean',work_video_related_consent:'boolean',work_video_consent_at:'timestamptz'};
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.jobs(id uuid primary key default gen_random_uuid(),job_number serial unique,farmer_id uuid not null,status text not null default 'draft',
        full_pay_guarantee boolean,draft_step_id text,${JOB_DRAFT_FIELDS.map(k=>`${k} ${types[k]||'text'}`).join(',')});
      alter table public.jobs enable row level security;
      grant select on public.jobs to authenticated;
      create policy own_read on public.jobs for select to authenticated using(farmer_id=auth.uid());
      grant usage on schema auth to authenticated;
      alter table public.jobs add constraint jobs_work_video_consent_check check(work_video_url is null or (work_video_job_consent is true and work_video_consent_at is not null and nullif(btrim(work_video_consent_version),'') is not null));
    `);
    const sample={...jobInputSample(),farmer_id:owner,status:'open',full_pay_guarantee:true,draft_step_id:'review'};
    const entries=Object.entries(sample);
    const seed=(await db.query(`insert into public.jobs(${entries.map(([k])=>k).join(',')}) values(${entries.map((_,i)=>'$'+(i+1)).join(',')}) returning job_number`,entries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v))).rows[0].job_number;
    const login=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
    const call=async n=>(await db.query('select public.copy_job($1) result',[n])).rows[0].result;
    await db.exec(await sql('./fixtures/copy-job-prod-20261018.sql'));
    await db.exec('revoke all on function public.copy_job(integer) from public,anon;grant execute on function public.copy_job(integer) to authenticated');
    await login(owner);
    await t.test('old production function reproduces missing scope and video fields',async()=>{
      const old=await call(seed);assert.equal(old.ok,true);
      for(const k of ['place_change_scope','task_change_scope','work_video_url'])assert.equal(old.job[k],null,k);
    });
    await db.exec('reset role');
    await db.exec(await sql('../supabase/migrations/20261018142821_copy_job_input_integrity.sql'));
    await login(owner);
    let copied;
    await t.test('every carry field equals its source; reset fields follow the central policy',async()=>{
      const r=await call(seed);assert.equal(r.ok,true);copied=r.job;
      assert.equal(r.dates_cleared,true);assert.equal(r.video_reconfirmation_required,true);
      assert.deepEqual(Object.keys(JOB_COPY_POLICY).sort(),[...JOB_DRAFT_FIELDS].sort());
      for(const [k,policy] of Object.entries(JOB_COPY_POLICY)){
        if(policy==='carry')assert.deepEqual(copied[k],sample[k],k);
        else if(policy==='schedule')assert.deepEqual(copied[k],k==='holidays'?[]:null,k);
        else if(policy==='consent')assert.equal(copied[k],k.endsWith('_consent')?false:null,k);
        else assert.equal(copied[k],12,k);
      }
      assert.equal(copied.draft_step_id,'review');assert.equal(copied.status,'draft');assert.equal(copied.farmer_id,owner);
      assert.equal(copied.full_pay_guarantee,sample.full_pay_guarantee);
      const source=(await db.query('select to_jsonb(j) row from public.jobs j where job_number=$1',[seed])).rows[0].row;
      assert.equal(source.work_video_job_consent,true);assert.equal(source.place_change_scope,sample.place_change_scope);assert.equal(source.status,'open');
    });
    await t.test('unconfirmed URL survives draft saves but cannot become pending or public',async()=>{
      await db.exec('reset role');
      await db.query("update public.jobs set notes='draft edited' where id=$1",[copied.id]);
      for(const status of ['pending','open','closed'])await assert.rejects(db.query('update public.jobs set status=$1 where id=$2',[status,copied.id]),/jobs_work_video_consent_check/);
      assert.equal((await db.query('select status from public.jobs where id=$1',[copied.id])).rows[0].status,'draft');
      await assert.rejects(db.query('update public.jobs set work_video_related_consent=true where id=$1',[copied.id]),/jobs_work_video_consent_check/);
      await db.query("update public.jobs set work_video_job_consent=true,work_video_consent_at=now(),work_video_consent_version='current',status='pending' where id=$1",[copied.id]);
      await login(owner);
    });
    await t.test('no-video copy and source deletion responses remain usable',async()=>{
      await db.exec('reset role');await db.query('update public.jobs set work_video_url=null where job_number=$1',[seed]);await login(owner);
      const r=await call(seed);assert.equal(r.ok,true);assert.equal(r.video_reconfirmation_required,false);assert.equal(r.job.work_video_url,null);
      assert.equal((await call(99999)).reason,'not_found');
    });
    await t.test('owner restriction and execution grants are retained',async()=>{
      await login(other);assert.equal((await call(seed)).reason,'not_yours');
      await login('');assert.equal((await call(seed)).reason,'not_logged_in');
      await db.exec('set role anon');await assert.rejects(call(seed),/permission denied/);
      await db.exec('reset role');
      const p=(await db.query("select proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') auth from pg_proc where oid='public.copy_job(integer)'::regprocedure")).rows[0];
      assert.ok(p.proconfig.includes('search_path=""'));assert.equal(p.anon,false);assert.equal(p.auth,true);
    });
    await db.exec('reset role');
    await db.exec(await sql('../supabase/migrations/20261018151053_job_copy_idempotent_request.sql'));
    const once=async(id,n=seed,user=owner)=>(await db.query('select public.copy_my_job_once($1,$2,$3) r',[user,id,n])).rows[0].r;
    const count=async()=>(await db.query('select count(*)::int n from public.jobs')).rows[0].n;
    await login(owner);let operation,receipt;
    await t.test('copy request replay keeps one target, with the existing complete copy policy',async()=>{
      const before=await count();operation=randomUUID();receipt=await once(operation);assert.equal(receipt.ok,true);assert.equal(receipt.owner,owner);assert.equal(receipt.request_id,operation);assert.equal(receipt.job.place_change_scope,sample.place_change_scope);
      const retry=await once(operation);assert.equal(retry.job_number,receipt.job_number);assert.equal(retry.replayed,true);assert.equal(retry.copy_unchanged,true);assert.equal(await count(),before+1);
      assert.equal((await once(operation,seed+999)).reason,'request_mismatch');
    });
    await t.test('edited or deleted copy is reconciled without creating a replacement',async()=>{
      await db.exec('reset role');await db.query("update public.jobs set notes='edited by another screen' where id=$1",[receipt.job.id]);await login(owner);
      const before=await count(),retry=await once(operation);assert.equal(retry.job.notes,'edited by another screen');assert.equal(retry.copy_unchanged,false);assert.equal(await count(),before);
      await db.exec('reset role');await db.query('delete from public.jobs where id=$1',[receipt.job.id]);await login(owner);
      assert.equal((await once(operation)).reason,'copy_deleted');assert.equal(await count(),before-1);
    });
    await t.test('receipt refusal rolls back the copied job and allows safe retry',async()=>{
      await db.exec('reset role');await db.exec(`create function public.qa_copy_receipt_failure() returns trigger language plpgsql as $$begin
        if current_setting('qa.copy_fail',true)='yes' then raise exception 'receipt failure';end if;return new;end$$;
        create trigger qa_copy_receipt_failure before insert on private.job_copy_requests for each row execute function public.qa_copy_receipt_failure();`);
      await login(owner);const before=await count(),id=randomUUID();await db.query("select set_config('qa.copy_fail','yes',false)");assert.equal((await once(id)).reason,'copy_rejected');assert.equal(await count(),before);
      await db.query("select set_config('qa.copy_fail','no',false)");assert.equal((await once(id)).ok,true);assert.equal(await count(),before+1);
    });
    await t.test('owner guard and ledger access protect replays; old non-idempotent RPC is closed',async()=>{
      await db.exec('reset role');await db.exec(await sql('../supabase/migrations/20261018151627_retire_non_idempotent_job_copy.sql'));await login(owner);
      await assert.rejects(call(seed),/permission denied/);await assert.rejects(db.query('select * from private.job_copy_requests'),/permission denied/);
      assert.equal((await once(randomUUID(),seed,other)).reason,'not_logged_in');await login(other);assert.equal((await once(operation,seed,other)).reason,'request_mismatch');assert.equal((await once(randomUUID(),seed,other)).reason,'not_yours');
      await login('');assert.equal((await once(randomUUID())).reason,'not_logged_in');await db.exec('set role anon');await assert.rejects(once(randomUUID()),/permission denied/);
    });
  } finally {await db.close();}
});
