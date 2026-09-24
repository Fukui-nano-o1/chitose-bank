import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.CB_TEST_NODE_MODULES ? `${process.env.CB_TEST_NODE_MODULES}/@electric-sql/pglite` : '@electric-sql/pglite');
const worker='10000000-0000-4000-8000-000000000001', farmer='10000000-0000-4000-8000-000000000002', stranger='10000000-0000-4000-8000-000000000003';
const app='20000000-0000-4000-8000-000000000001', second='20000000-0000-4000-8000-000000000002';
const migration = name => readFile(new URL(`../supabase/migrations/${name}.sql`,import.meta.url),'utf8');

test('existing review schema saves optional values and publishes only positive counts behind its current gates', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      create table applications(id uuid primary key,worker_id uuid,farmer_id uuid,job_number int,status text,work_completed_at timestamptz);
      create table jobs(farmer_id uuid,status text);
      create function app_phase(a applications) returns text language sql as $$select a.status$$;
      grant select on applications to authenticated;
      insert into applications values('${app}','${worker}','${farmer}',1,'completed',now()),('${second}','${worker}','${farmer}',2,'completed',now());`);
    // Use the committed migration definitions; omit historical one-off data updates.
    await db.exec((await migration('20260713101312_reviews_v1_and_first_completion')).split('-- ===== 実績1件目')[0]);
    await db.exec((await migration('20260713133622_reviews_v2_frozen_schema')).split('-- 1件目')[0]);
    await db.exec(await migration('20260806233349_reviews_party_consistency_gate'));
    await db.exec(await migration('20260807020949_reviews_phase_gate'));
    await db.exec(await migration('20260819061155_reviews_worker_to_farmer_more_items'));
    await db.exec((await migration('20260820102733_final_review_three_questions')).split('-- 未払いの報告')[0]);
    await db.exec("alter table reviews add column comment_status text; grant select,insert on reviews to authenticated;");
    await db.exec(await migration('20260825154145_reviews_public_badges_waiting_count'));
    const as = async id => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated'); };
    const badges = async () => (await db.query("select reviews_public_badges($1,'worker_to_farmer') as result",[farmer])).rows[0].result;
    await as(worker);
    await db.query(`insert into reviews(application_id,reviewer_id,reviewee_id,direction,instructions_clear,safety_care,on_time)
      values($1,$2,$3,'worker_to_farmer',true,false,null)`,[app,worker,farmer]);
    let result = await badges();
    assert.equal(result.waiting,1); assert.equal(result.badges.instructions_clear,0);
    await as(farmer);
    assert.equal((await db.query('select count(*)::int as n from reviews')).rows[0].n,0,'recipient cannot read raw negative answers');
    await db.query(`insert into reviews(application_id,reviewer_id,reviewee_id,direction) values($1,$2,$3,'farmer_to_worker')`,[app,farmer,worker]);
    result = await badges();
    assert.equal(result.badges.instructions_clear,1);
    assert.equal(result.badges.safety_care,0);
    assert.equal(result.badges.on_time,0);
    assert.equal(Object.keys(result.badges).some(key=>/negative|false|no_count/.test(key)),false);
    await as(worker);
    await db.query(`insert into reviews(application_id,reviewer_id,reviewee_id,direction,instructions_clear,safety_care,on_time)
      values($1,$2,$3,'worker_to_farmer',null,true,true)`,[second,worker,farmer]);
    assert.equal((await badges()).badges.safety_care,0,'second answer remains hidden while waiting');
    await db.exec("reset role; update applications set work_completed_at=now()-interval '4 days';");
    await as(farmer); result=await badges();
    assert.equal(result.badges.instructions_clear,1); assert.equal(result.badges.safety_care,1); assert.equal(result.badges.on_time,1);
    await as(stranger);
    assert.equal((await badges()).ok,false,'unrelated viewer is denied');
    await assert.rejects(()=>db.query(`insert into reviews(application_id,reviewer_id,reviewee_id,direction,safety_care) values($1,$2,$3,'worker_to_farmer',false)`,[second,stranger,farmer]),/当事者|row-level security/);
  } finally { await db.close(); }
});
