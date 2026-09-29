import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const worker='10000000-0000-4000-8000-000000000001', farmer='10000000-0000-4000-8000-000000000002', stranger='10000000-0000-4000-8000-000000000003';
const sqlFile = name => readFile(new URL(`../supabase/migrations/${name}.sql`,import.meta.url),'utf8');

test('fixed 72-hour review window: direct writes, both RPCs, all public counts, notifications and retained single reviews',async t=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,created_at timestamptz default now());
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      create function public.is_account_moderated(uuid) returns boolean language sql as $$select false$$;
      create function public.resolve_actor_name(uuid) returns text language sql as $$select 'test person'::text$$;
      create function public.app_accrued_minutes(uuid) returns int language sql as $$select 0$$;
      create function public.my_unread_message_counts() returns json language sql as $$select '{"by_application":{},"dm":0}'::json$$;
      create function public.job_ref(int,text) returns text language sql as $$select 'test job'::text$$;
      create table test_mail(subject text,body text);
      create function public.send_user_email(uuid,text,text) returns void language sql as $$insert into public.test_mail values($2,$3)$$;
      create function public.notify_admins(text,text) returns void language sql as $$select$$;`);
    await db.exec(await readFile(new URL('./fixtures/reviews/deadline-schema.sql',import.meta.url),'utf8'));
    await db.exec(`alter table applications add primary key(id); alter table jobs add primary key(job_number);
      alter table repeat_roster add primary key(farmer_id,worker_id);
      insert into auth.users(id) values('${worker}'),('${farmer}');
      grant select on applications to authenticated;`);
    for(const [name,split] of [
      ['20260713101312_reviews_v1_and_first_completion','-- ===== 実績1件目'],
      ['20260713133622_reviews_v2_frozen_schema','-- 1件目'],
      ['20260806233349_reviews_party_consistency_gate'],
      ['20260807020949_reviews_phase_gate'],
      ['20260819061155_reviews_worker_to_farmer_more_items'],
      ['20260820102733_final_review_three_questions','-- 未払いの報告'],
    ]) {const source=await sqlFile(name);await db.exec(split?source.split(split)[0]:source);}
    await db.exec('alter table reviews add column comment_status text; grant select,insert on reviews to authenticated; grant select,insert,update on reviews to service_role;');
    await db.exec(await sqlFile('20260929135935_expand_work_review_catalog'));
    await db.exec(await sqlFile('20260929142755_fixed_review_window_72_hours'));
    await db.exec('create trigger review_celebration after insert on reviews for each row execute function trg_review_celebration();');
    const as=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
    const appRow=async(n,hours,status='completed')=>{
      const id=`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
      await db.exec('reset role');
      await db.query("insert into jobs(job_number,farmer_id,status,work_time) values($1,$2,'closed','08:00〜17:00')",[n,farmer]);
      await db.query("insert into applications(id,worker_id,farmer_id,job_number,status,work_completed_at,started_at,attended) values($1,$2,$3,$4,$5,clock_timestamp()-$6::interval,clock_timestamp()-interval '8 days',true)",[id,worker,farmer,n,status,`${hours} hours`]);
      return id;
    };
    const windowFor=async id=>(await db.query('select review_window($1) as r',[id])).rows[0].r;
    const insert=async(id,direction,extra={})=>{
      const f=direction==='farmer_to_worker';
      const row={application_id:id,direction,reviewer_id:f?farmer:worker,reviewee_id:f?worker:farmer,want_again:true,traits:JSON.stringify(f?['teamwork']:['job_tools_ready_good']),...extra};
      const keys=Object.keys(row);
      return db.query(`insert into reviews(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
    };
    const final=async id=>(await db.query("select submit_farmer_final_review($1,'completed','yes','[\"teamwork\"]',true) as r",[id])).rows[0].r;
    const legacy=async id=>(await db.query("select submit_farmer_review($1,true,true,'comment',null,true) as r",[id])).rows[0].r;
    const badges=async(uid,direction)=>(await db.query('select reviews_public_badges($1,$2) as r',[uid,direction])).rows[0].r;

    await t.test('exact start and deadline use a half-open 72-hour interval',async()=>{
      const at='2026-10-01T08:00:00Z';
      for(const [delta,expected] of [[-1,'not_started'],[0,'open'],[259199.999,'open'],[259200,'closed'],[259201,'closed']]) {
        const row=(await db.query("select review_window_state($1::timestamptz,$1::timestamptz+$2::interval) as s",[at,`${delta} seconds`])).rows[0];
        assert.equal(row.s,expected);
      }
    });
    const both=await appRow(1,48);
    await t.test('48 hours remains open, both submitted reviews stay hidden and receipt messages reveal no answers',async()=>{
      await as(worker); assert.equal((await windowFor(both)).state,'open');
      assert.ok((await db.query('select * from my_todo_items()')).rows.some(r=>r.application_id===both&&r.stage==='w_review'));
      await insert(both,'worker_to_farmer');
      await as(farmer); await insert(both,'farmer_to_worker');
      assert.equal((await badges(worker,'farmer_to_worker')).badges.trait_teamwork,0);
      assert.equal((await badges(farmer,'worker_to_farmer')).badges.want_again,0);
      assert.equal((await db.query('select worker_want_again_count($1) as r',[worker])).rows[0].r.want_again_count,0);
      assert.equal((await db.query('select worker_trust_info($1) as r',[worker])).rows[0].r.want_again_count,0);
      assert.equal((await db.query('select worker_trust_info_bulk($1) as r',[[worker]])).rows[0].r[worker].want_again_count,0);
      assert.equal((await db.query('select employer_trust_info($1) as r',[farmer])).rows[0].r.want_again_workers,0);
      await as(worker); assert.equal((await db.query('select my_worker_trust_stats() as r')).rows[0].r.want_again_count,0);
      await db.exec('reset role');
      const mails=(await db.query('select * from test_mail')).rows;
      assert.equal(mails.length,2);
      for(const mail of mails) assert.doesNotMatch(mail.body+mail.subject,/また呼びたい|また働きたい|test person|おめでとう/);
    });
    const single=await appRow(2,48);
    await t.test('a single review is retained and published at 72 hours, with all aggregate routes consistent',async()=>{
      await as(worker); await insert(single,'worker_to_farmer');
      await db.exec('reset role');
      // Local test clock only: advance the fixed origin to model 25 elapsed hours.
      await db.exec('alter table applications disable trigger app_review_clock');
      await db.query("update applications set review_opened_at=clock_timestamp()-interval '73 hours' where id in ($1,$2)",[both,single]);
      await db.exec('alter table applications enable trigger app_review_clock');
      await as(worker);
      assert.equal((await badges(farmer,'worker_to_farmer')).badges.trait_job_tools_ready_good,2);
      assert.equal((await badges(worker,'farmer_to_worker')).badges.trait_teamwork,1);
      assert.equal((await db.query('select worker_want_again_count($1) as r',[worker])).rows[0].r.want_again_count,1);
      assert.equal((await db.query('select worker_trust_info($1) as r',[worker])).rows[0].r.want_again_count,1);
      assert.equal((await db.query('select worker_trust_info_bulk($1) as r',[[worker]])).rows[0].r[worker].want_again_count,1);
      assert.equal((await db.query('select my_worker_trust_stats() as r')).rows[0].r.want_again_count,1);
      assert.equal((await db.query('select employer_trust_info($1) as r',[farmer])).rows[0].r.want_again_workers,2);
      assert.equal((await db.query('select count(*)::int n from reviews where application_id=$1',[single])).rows[0].n,1);
    });
    const closed=await appRow(3,73),future=await appRow(4,-1,'working');
    await t.test('direct insert, forged dates, legacy RPC, new RPC and privileged writes cannot submit after the deadline',async()=>{
      await as(worker);
      assert.equal((await windowFor(closed)).state,'closed');
      assert.equal((await windowFor(future)).state,'not_started');
      await assert.rejects(()=>insert(future,'worker_to_farmer'),/review_window_not_started/);
      await assert.rejects(()=>insert(closed,'worker_to_farmer',{created_at:'2026-01-01',published_at:'2026-01-01'}),/review_window_closed/);
      await as(farmer);
      assert.equal((await final(closed)).reason,'review_window_closed');
      assert.equal((await legacy(closed)).reason,'review_window_closed');
      assert.equal((await db.query('select * from my_todo_items()')).rows.some(r=>r.application_id===closed&&['complete','w_review'].includes(r.stage)),false);
      await db.exec('reset role;set role service_role');
      await assert.rejects(()=>insert(closed,'farmer_to_worker'),/review_window_closed/);
      await assert.rejects(()=>db.query('update reviews set want_again=false where application_id=$1',[both]),/review_window_closed/);
      await db.query("update reviews set comment_status='rejected' where application_id=$1",[both]);
      await db.exec('reset role');
      assert.equal((await db.query('select count(*)::int n from repeat_roster')).rows[0].n,0);
      assert.equal((await db.query('select count(*)::int n from test_mail')).rows[0].n,3);
    });
    const late=await appRow(5,-1,'working');
    await t.test('late completion does not reopen the window and multi-day work waits for its last date',async()=>{
      await db.exec('reset role');
      await db.query("update jobs set date_start=(now() at time zone 'Asia/Tokyo')::date-5,date_end=(now() at time zone 'Asia/Tokyo')::date-4 where job_number=5");
      await as(farmer); assert.equal((await final(late)).reason,'review_window_closed');
      await db.query('select complete_work($1,true)',[late]);
      assert.equal((await windowFor(late)).state,'closed');
      assert.equal((await legacy(late)).reason,'review_window_closed');
      await db.exec('reset role');
      await db.query("update jobs set date_start=(now() at time zone 'Asia/Tokyo')::date-1,date_end=(now() at time zone 'Asia/Tokyo')::date+1 where job_number=4");
      await as(worker); assert.equal((await windowFor(future)).state,'not_started');
      await assert.rejects(()=>insert(future,'worker_to_farmer'),/review_window_not_started/);
      await as(stranger); assert.equal((await windowFor(both)).ok,false);
      await db.exec('reset role;set role anon');
      await assert.rejects(()=>windowFor(both),/permission denied/);
    });
    await t.test('editing a finished job, agreed dates or the completion timestamp never reopens a closed review window',async()=>{
      await db.exec('reset role');
      await db.query("update jobs set date_start=(now() at time zone 'Asia/Tokyo')::date+1,date_end=(now() at time zone 'Asia/Tokyo')::date+2 where job_number=5");
      await db.query("update applications set agreed_dates=jsonb_build_array(((now() at time zone 'Asia/Tokyo')::date+2)::text),work_completed_at=now(),review_opened_at=now() where id=$1",[late]);
      await as(farmer); assert.equal((await windowFor(late)).state,'closed');
      assert.equal((await final(late)).reason,'review_window_closed');
      await db.exec('reset role');
      const moved=await appRow(6,-1,'working');
      await db.query("update jobs set date_start=(now() at time zone 'Asia/Tokyo')::date-5,date_end=(now() at time zone 'Asia/Tokyo')::date-4 where job_number=6");
      await db.query("update jobs set date_start=(now() at time zone 'Asia/Tokyo')::date+1,date_end=(now() at time zone 'Asia/Tokyo')::date+2 where job_number=6");
      await as(worker); assert.equal((await windowFor(moved)).state,'closed');
      await assert.rejects(()=>insert(moved,'worker_to_farmer'),/review_window_closed/);
    });
  } finally {await db.close();}
});
