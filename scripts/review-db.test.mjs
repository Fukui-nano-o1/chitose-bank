import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { buildWorkReviewPayload, WORK_REVIEW_POINTS } from '../src/lib/workReview.js';
import { detailReviewTags } from '../src/lib/reviewCatalog.js';
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.CB_TEST_NODE_MODULES ? `${process.env.CB_TEST_NODE_MODULES}/@electric-sql/pglite` : '@electric-sql/pglite');
const worker='10000000-0000-4000-8000-000000000001', farmer='10000000-0000-4000-8000-000000000002', stranger='10000000-0000-4000-8000-000000000003';
const app='20000000-0000-4000-8000-000000000001', second='20000000-0000-4000-8000-000000000002';
const migration = name => readFile(new URL(`../supabase/migrations/${name}.sql`,import.meta.url),'utf8');

test('expanded review payloads save and only positive counts publish behind the existing gates', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
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
    // The RPC runs against a local completion stub. It never calls production notifications.
    await db.exec(`create table completion_calls(application_id uuid);
      create function complete_work(p_id uuid,p_attended boolean) returns json language plpgsql as $$
      begin insert into completion_calls values(p_id); return '{"ok":true}'::json; end; $$;
      create table repeat_roster(farmer_id uuid,worker_id uuid,source_application_id uuid,notify boolean,primary key(farmer_id,worker_id));`);
    await db.exec(await migration('20260929135935_expand_work_review_catalog'));
    const as = async id => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated'); };
    const badges = async () => (await db.query("select reviews_public_badges($1,'worker_to_farmer') as result",[farmer])).rows[0].result;
    const insertWorker = async (id, answers, unpaid = false) => {
      const payload = buildWorkReviewPayload({app:{id,farmer_id:farmer},meId:worker,answers,unpaid});
      const columns = Object.keys(payload);
      await db.query(`insert into reviews(${columns.join(',')}) values(${columns.map((_,i)=>`$${i+1}`).join(',')})`, columns.map(key=>key==='traits'?JSON.stringify(payload[key]):payload[key]));
      return (await db.query('select * from reviews where application_id=$1 and reviewer_id=$2',[id,worker])).rows[0];
    };
    await as(worker);
    let saved = await insertWorker(app,{as_described:'negative',instructions_clear:'positive',safety_care:'negative',paid_as_posted:'negative',want_again:'positive',tools_ready:'positive',rest_water:'negative'});
    assert.equal(saved.as_described,false); assert.equal(saved.match_level,null);
    assert.equal(saved.safety_care,false); assert.equal(saved.instructions_clear,true);
    assert.equal(saved.pay_status,'other','a complaint must not create an unpaid incident');
    assert.equal(saved.want_again_choice,'yes');
    assert.deepEqual(saved.traits,['job_tools_ready_good','job_rest_water_improve']);
    let result = await badges();
    assert.equal(result.waiting,1); assert.equal(result.badges.instructions_clear,0);
    assert.equal(result.badges.trait_job_tools_ready_good,0);
    await as(farmer);
    assert.equal((await db.query('select count(*)::int as n from reviews')).rows[0].n,0,'recipient cannot read raw negative answers');
    await db.query(`insert into reviews(application_id,reviewer_id,reviewee_id,direction,traits) values($1,$2,$3,'farmer_to_worker','["careful","teamwork","safety_issue"]')`,[app,farmer,worker]);
    result = await badges();
    assert.equal(result.badges.instructions_clear,1);
    assert.equal(result.badges.safety_care,0);
    assert.equal(result.badges.as_described,0); assert.equal(result.badges.paid_as_posted,0);
    assert.equal(result.badges.want_again,1);
    assert.equal(result.badges.on_time,0);
    assert.equal(result.badges.trait_job_tools_ready_good,1);
    assert.equal(Object.keys(result.badges).some(key=>/negative|false|no_count|_issue|_improve/.test(key)),false);
    const workerBadges=(await db.query("select reviews_public_badges($1,'farmer_to_worker') as result",[worker])).rows[0].result;
    assert.equal(workerBadges.badges.trait_careful,1); assert.equal(workerBadges.badges.trait_teamwork,1);
    assert.equal(Object.keys(workerBadges.badges).some(key=>/_issue|_improve/.test(key)),false);
    await as(worker);
    saved = await insertWorker(second,{safety_care:'positive',as_described:'positive',paid_as_posted:'positive'});
    assert.equal(saved.instructions_clear,null); assert.equal(saved.want_again,null);
    assert.equal(saved.match_level,'matched'); assert.equal(saved.pay_status,'paid');
    assert.equal((await badges()).badges.safety_care,0,'second answer remains hidden while waiting');
    await db.exec("reset role; update applications set work_completed_at=now()-interval '4 days'; update reviews set on_time=true where application_id='"+second+"';");
    await as(farmer); result=await badges();
    assert.equal(result.badges.instructions_clear,1); assert.equal(result.badges.safety_care,1); assert.equal(result.badges.on_time,1);
    assert.equal(result.badges.as_described,1); assert.equal(result.badges.paid_as_posted,1);
    // All skipped is valid and still distinguishable from a negative evaluation.
    await db.exec('reset role');
    for (const [index, answers, unpaid] of [
      [3,{},false],
      [4,Object.fromEntries(WORK_REVIEW_POINTS.map(point=>[point.key,'negative'])),true],
    ]) {
      const id=`20000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
      await db.query("insert into applications values($1,$2,$3,$4,'completed',now())",[id,worker,farmer,index]);
      await as(worker); saved = await insertWorker(id,answers,unpaid);
      for (const point of WORK_REVIEW_POINTS.filter(p=>p.column)) assert.equal(saved[point.key],index===3 ? null : false);
      assert.equal(saved.traits.length,index===3 ? 0 : 15);
      assert.equal(saved.pay_status,index===3 ? null : 'unpaid');
      assert.equal(saved.want_again_choice,index===3 ? null : 'no');
      await db.exec('reset role');
    }
    await as(stranger);
    assert.equal((await badges()).ok,false,'unrelated viewer is denied');
    await assert.rejects(()=>db.query(`insert into reviews(application_id,reviewer_id,reviewee_id,direction,safety_care) values($1,$2,$3,'worker_to_farmer',false)`,[second,stranger,farmer]),/当事者|row-level security/);
    await as(worker);
    for (const direction of ['worker_to_farmer','farmer_to_worker']) {
      const valid = (await db.query('select review_traits_valid($1,$2::jsonb) as ok',[direction,JSON.stringify(detailReviewTags(direction).map(t=>t.v))])).rows[0].ok;
      assert.equal(valid,true,`every catalog key must be accepted: ${direction}`);
    }
    for (const traits of [{careful:true},'careful',[null],[2],['unknown'],['careful','careful'],['job_tools_ready_good'],Array(41).fill('careful')]) {
      assert.equal((await db.query("select review_traits_valid('farmer_to_worker',$1::jsonb) as ok",[JSON.stringify(traits)])).rows[0].ok,false);
    }
    assert.equal((await db.query("select review_traits_valid('worker_to_farmer','[\"careful\"]') as ok")).rows[0].ok,false);
    await db.exec('reset role');
    const third='20000000-0000-4000-8000-000000000005';
    await db.query("insert into applications values($1,$2,$3,5,'completed',now())",[third,worker,farmer]);
    await as(worker);
    await assert.rejects(()=>db.query(`insert into reviews(application_id,reviewer_id,reviewee_id,direction,traits) values($1,$2,$3,'worker_to_farmer','["careful"]')`,[third,worker,farmer]),/reviews_traits_catalog_check/);
    const submit = async (id, outcome, again, traits, favorite=false) => (await db.query('select submit_farmer_final_review($1,$2,$3,$4::jsonb,$5) as result',[id,outcome,again,JSON.stringify(traits),favorite])).rows[0].result;
    await as(farmer);
    assert.equal((await submit(third,'completed','yes',['unknown'],true)).reason,'bad_input');
    assert.equal((await submit(third,null,'yes',[])).reason,'bad_input');
    await as(stranger);
    assert.equal((await submit(third,'completed','yes',['teamwork'])).reason,'not_yours');
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as n from completion_calls')).rows[0].n,0,'invalid payloads never reach completion');
    await as(farmer);
    assert.equal((await submit(third,'partial','yes',['teamwork','safety_issue'],true)).ok,true);
    const savedFarmer=(await db.query('select traits,completed_work from reviews where application_id=$1',[third])).rows[0];
    assert.deepEqual(savedFarmer.traits,['teamwork','safety_issue']); assert.equal(savedFarmer.completed_work,false);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as n from completion_calls')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int as n from repeat_roster')).rows[0].n,1);
    await db.exec('set role anon');
    await assert.rejects(()=>db.query('select submit_farmer_final_review($1,$2,$3,$4::jsonb,$5)',[third,'completed','yes','[]',false]),/permission denied/);
  } finally { await db.close(); }
});
