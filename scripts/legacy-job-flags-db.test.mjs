import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { legacyJobFlagsSchema, legacyJobFlagsRuntime } from './fixtures/legacy-job-flags-schema.mjs';
const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
const migration = await read('supabase/migrations/20261105215520_isolate_legacy_job_flags.sql');
const rollback = await read('docs/rollback/restore-legacy-job-flags.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const farmer=id(1), worker=id(2), nextWorker=id(3), stranger=id(4), admin=id(5);
// Synthetic fixture with catalog-read production routines. No real users, email,
// network, auth, or production writes. Single-session PGlite is NOT a concurrency test.
test('retired job flags preserve records, close auto-approval and keep ordinary workflows', async t => {
  const db = new PGlite();
  const rows = async (sql,args=[]) => (await db.query(sql,args)).rows;
  const login = async (uid,role='authenticated') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({email:uid===admin?'admin@example.invalid':'member@example.invalid'})]);
    await db.exec('set role '+role);
  };
  const apply = async job => (await rows('select public.apply_to_job($1,null) result',[job]))[0].result;
  const fullState = async () => {
    await db.exec('reset role');
    return (await rows(`select jsonb_build_object(
      'jobs',(select jsonb_agg(to_jsonb(j) order by job_number) from jobs j),
      'apps',(select jsonb_agg(to_jsonb(a) order by id) from applications a),
      'roster',(select jsonb_agg(to_jsonb(r) order by worker_id) from repeat_roster r),
      'notifications',(select jsonb_agg(to_jsonb(n) order by id) from notifications n),
      'messages',(select jsonb_agg(to_jsonb(m) order by id) from messages m),
      'mail',(select jsonb_agg(to_jsonb(m) order by id) from qa_mail m)) s`))[0].s;
  };
  const expectDenied = async operation => {
    await db.exec('savepoint denied');
    await assert.rejects(operation, error => error.code==='42501');
    await db.exec('rollback to savepoint denied');
  };
  try {
    await db.exec(legacyJobFlagsSchema({farmer,worker,nextWorker,stranger}));
    await db.exec(await read('scripts/fixtures/legacy-job-flags-production.sql'));
    await db.exec(await read('scripts/fixtures/legacy-job-flags-display-production.sql'));
    await db.exec(await read('scripts/fixtures/legacy-job-flags-party-production.sql'));
    await db.exec('revoke all on function job_details_for_party(integer[]) from public,anon;grant execute on function job_details_for_party(integer[]) to authenticated,service_role');
    await db.exec(await read('scripts/fixtures/legacy-job-flags-copy-production.sql'));
    await db.exec(legacyJobFlagsRuntime);
    await login(worker);
    const baseline = await apply(10);
    await db.exec('reset role');
    assert.equal((await rows('select status from applications where id=$1',[baseline.application_id]))[0].status,'approved');
    const before = await fullState();
    const originalFunctions=(await rows(`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,array(select a::text from unnest(proacl) a order by a::text) acl
      from pg_proc p where p.oid in ('job_details_for_party(integer[])'::regprocedure,'apply_to_job(integer,jsonb)'::regprocedure,'my_farm_jobs()'::regprocedure,'trg_instant_approve()'::regprocedure,'trg_notify_roster()'::regprocedure,'trg_notify_application()'::regprocedure) order by 1`));
    const originalView=(await rows("select pg_get_viewdef('jobs_public'::regclass,true) definition,relacl::text acl,reloptions from pg_class where oid='jobs_public'::regclass"))[0];
    for (const [label,change] of [
      ['function', "alter function public.trg_instant_approve() set search_path=''"],
      ['RPC privilege', 'grant execute on function apply_to_job(integer,jsonb) to anon'],
      ['application write policy', 'create policy unsafe on applications for update using(true)'],
      ['view security', 'alter view jobs_public set (security_barrier=false)'],
      ['pending legacy mail', "create schema net;create table net.http_request_queue(body bytea);insert into net.http_request_queue values(convert_to('リピート即決','UTF8'))"],
    ]) await t.test(`preflight refuses ${label} drift atomically`, async()=>{
      await db.exec('begin');await db.exec(change);
      await db.exec('savepoint preflight');
      await assert.rejects(db.exec(migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'')), /JOB_FLAGS_(PREFLIGHT_DRIFT|PENDING_LEGACY_MAIL)/);
      await db.exec('rollback to savepoint preflight');
      assert.equal((await rows("select to_regnamespace('retired_job_flags') n"))[0].n,null);
      await db.exec('rollback');
    });
    await db.exec(migration);
    await t.test('migration does not rewrite old jobs, approvals, roster, messages, mail or notifications',async()=>assert.deepEqual(await fullState(),before));
    await t.test('archive is inert text with no table or schema access for exposed roles',async()=>{
      for(const role of ['anon','authenticated','service_role']){
        const acl=(await rows("select has_schema_privilege($1,'retired_job_flags','usage') s,has_table_privilege($1,'retired_job_flags.function_archive','select') t,has_function_privilege($1,'trg_instant_approve()','execute') f",[role]))[0];
        assert.deepEqual(acl,{s:false,t:false,f:false});
      }
      assert.equal((await rows("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='retired_job_flags'"))[0].n,0);
      assert.equal((await rows("select count(*)::int n from retired_job_flags.function_archive"))[0].n,6);
      await db.exec('begin');await login(worker);
      await expectDenied(()=>rows('select * from retired_job_flags.function_archive'));
      await expectDenied(()=>rows('select trg_instant_approve()'));
      await db.exec('rollback;reset role');
    });
    await t.test('public view and farmer cards mask both flags; other privacy rules and owner edit values survive',async()=>{
      await login(null,'anon');const publicJob=(await rows('select * from jobs_public where job_number=10'))[0];
      assert.equal(publicJob.beginner_ok,false);assert.equal(publicJob.instant_approve_repeat,false);assert.equal(publicJob.experienced_preferred,true);
      assert.equal(publicJob.work_address,null);assert.equal(publicJob.town,null);assert.equal(publicJob.work_video_url,null);assert.equal(Number(publicJob.lat),34.12);
      const siblings=await rows('select * from employer_public_jobs(10)');assert.equal(siblings[0].beginner_ok,false);
      await login(farmer);const cards=(await rows('select my_farm_jobs() r'))[0].r.jobs;
      assert.ok(cards.every(j=>!j.beginner_ok&&!j.instant_approve_repeat));
      assert.equal((await rows('select beginner_ok from jobs where job_number=10'))[0].beginner_ok,true);
      const party=(await rows('select job_details_for_party(array[10]) r'))[0].r;
      assert.equal(party[0].beginner_ok,false);assert.equal(party[0].instant_approve_repeat,false);
      await login(worker);assert.equal((await rows('select job_details_for_party(array[10]) r'))[0].r[0].beginner_ok,false);
      await login(stranger);assert.deepEqual((await rows('select job_details_for_party(array[10]) r'))[0].r,[]);

      await db.exec('reset role');
      const view=(await rows("select relacl::text acl,reloptions from pg_class where oid='jobs_public'::regclass"))[0];
      assert.equal(view.acl,originalView.acl);assert.deepEqual(view.reloptions,originalView.reloptions);
    });
    await t.test('old ON job and roster member remain applied, duplicate retry adds nothing, ordinary mail continues',async()=>{
      await login(nextWorker);const result=await apply(10);assert.equal(result.ok,true);
      await db.exec('reset role');assert.equal((await rows('select status from applications where id=$1',[result.application_id]))[0].status,'applied');
      const mail=await rows('select * from qa_mail where id>$1',[before.mail.at(-1).id]);
      assert.equal(mail.length,2);assert.ok(mail.every(m=>!(/即決|自動で承認/.test(m.body))));
      const after=await fullState();await login(nextWorker);assert.equal((await apply(10)).already,true);assert.deepEqual(await fullState(),after);
    });
    await t.test('malicious direct writes and worker/stranger approval cannot change status; owner approval works',async()=>{
      const app=(await rows('select id from applications where worker_id=$1',[nextWorker]))[0].id;
      for(const actor of [worker,nextWorker,stranger,admin,farmer]){
        await login(actor);assert.equal((await rows("update applications set status='approved' where id=$1 returning id",[app])).length,0);
        if(actor!==farmer)assert.equal((await rows('select approve_application($1,true) r',[app]))[0].r.ok,false);
      }
      await db.exec('begin');await login(null,'anon');
      await expectDenied(()=>apply(10));
      await expectDenied(()=>rows(`insert into applications(job_number,worker_id,farmer_id,status) values(10,'${stranger}','${farmer}','approved')`));
      await login(nextWorker);await expectDenied(()=>rows(`insert into applications(job_number,worker_id,farmer_id,status) values(10,'${stranger}','${farmer}','approved')`));
      await db.exec('rollback;reset role');
      await login(farmer);assert.equal((await rows('select approve_application($1,true) r',[app]))[0].r.ok,true);
      await db.exec('reset role');assert.equal((await rows('select status from applications where id=$1',[app]))[0].status,'approved');
    });
    await t.test('old clients cannot change retained values; new inserts and service copy return false',async()=>{
      await login(farmer);
      const retained=(await rows('update jobs set beginner_ok=false,instant_approve_repeat=false where job_number=11 returning beginner_ok,instant_approve_repeat'))[0];
      assert.deepEqual(retained,{beginner_ok:true,instant_approve_repeat:true});
      const fresh=(await rows(`insert into jobs(farmer_id,status,beginner_ok,instant_approve_repeat) values('${farmer}','draft',true,true) returning beginner_ok,instant_approve_repeat`))[0];
      assert.deepEqual(fresh,{beginner_ok:false,instant_approve_repeat:false});
      await login(stranger);assert.equal((await rows("update jobs set beginner_ok=false where job_number=11 returning job_number")).length,0);
      await login(admin);
      assert.deepEqual((await rows("update jobs set beginner_ok=false,instant_approve_repeat=false where job_number=10 returning beginner_ok,instant_approve_repeat"))[0],{beginner_ok:true,instant_approve_repeat:true});
      await login(farmer,'service_role');const copy=(await rows('select copy_job(10) r'))[0].r;
      assert.equal(copy.ok,true);assert.equal(copy.job.beginner_ok,false);assert.equal(copy.job.instant_approve_repeat,false);
      await db.exec('reset role');assert.equal((await rows('select beginner_ok from jobs where job_number=10'))[0].beginner_ok,true);
    });
    await t.test('admin direct insert and even accidental trigger re-enable cannot auto approve',async()=>{
      await db.exec('reset role;begin;alter table applications enable trigger instant_approve');
      await db.exec(`insert into applications(job_number,farmer_id,worker_id,status) values(11,'${farmer}','${worker}','applied')`);
      assert.equal((await rows('select status from applications where job_number=11'))[0].status,'applied');
      await db.exec('rollback');
    });
    await t.test('roster ordinary new-job notice survives but never advertises instant approval',async()=>{
      const n=(await rows('select max(id) id from qa_mail'))[0].id;
      await db.exec("update jobs set status='open' where job_number=11");
      const mail=await rows('select body from qa_mail where id>$1',[n]);assert.equal(mail.length,2);
      assert.ok(mail.every(x=>!(/即決|自動承認|選考なし/.test(x.body))));
    });
    for(const [label,change] of [
      ['function', "alter function trg_notify_roster() set search_path=''"],
      ['ACL', 'grant execute on function apply_to_job(integer,jsonb) to anon'],
      ['view option', 'alter view jobs_public set (security_barrier=false)'],
      ['legacy trigger', 'alter table applications enable trigger instant_approve'],
      ['isolation trigger', 'alter table jobs disable trigger a_isolate_legacy_job_flags'],
      ['isolation helper', "alter function isolate_legacy_job_flags() set search_path='public'"],
    ]) await t.test(`rollback refuses later ${label} changes without partial restoration`,async()=>{
      await db.exec('begin');await db.exec(change);await db.exec('savepoint drift');
      await assert.rejects(db.exec(rollback.replace(/^begin;$/m,'').replace(/^commit;$/m,'')),/JOB_FLAGS_ROLLBACK_DRIFT/);
      await db.exec('rollback to savepoint drift');
      assert.equal((await rows("select count(*)::int n from retired_job_flags.function_archive"))[0].n,6);
      await db.exec('rollback');
    });
    await t.test('rollback restores exact old routines and ACLs, preserves all current records',async()=>{
      const state=await fullState();await db.exec(rollback);assert.deepEqual(await fullState(),state);
      const current=(await rows(`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,array(select a::text from unnest(proacl) a order by a::text) acl
        from pg_proc p where p.oid in ('job_details_for_party(integer[])'::regprocedure,'apply_to_job(integer,jsonb)'::regprocedure,'my_farm_jobs()'::regprocedure,'trg_instant_approve()'::regprocedure,'trg_notify_roster()'::regprocedure,'trg_notify_application()'::regprocedure) order by 1`));
      assert.deepEqual(current,originalFunctions);
      assert.equal((await rows("select pg_get_viewdef('jobs_public'::regclass,true) d"))[0].d,originalView.definition);
      assert.equal((await rows("select tgenabled from pg_trigger where tgname='instant_approve'"))[0].tgenabled,'O');
    });
  } finally { await db.close(); }
});
