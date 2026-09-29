import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/20260929060407_admin_work_reviews.sql', import.meta.url), 'utf8');
const admin='10000000-0000-4000-8000-000000000001', user='10000000-0000-4000-8000-000000000002';
test('admin work reviews: gates, explicit fields, completion filter, stable pagination and both directions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table app_admins(auth_id uuid primary key);
      insert into app_admins values ('${admin}');
      create table applications(id uuid primary key, job_number int, worker_id uuid, farmer_id uuid, status text, work_completed_at timestamptz);
      create table jobs(job_number int primary key,crop text,task text);
      create table worker_profiles(auth_id uuid primary key,nickname text);
      create table employer_profiles(auth_id uuid primary key,nickname text);
      create table reviews(id uuid primary key,application_id uuid,direction text,created_at timestamptz,
        as_described bool,instructions_clear bool,safety_care bool,paid_as_posted bool,want_again bool,
        match_level text,pay_status text,want_again_choice text,work_outcome text,traits jsonb,
        completed_work bool,followed_instructions bool,entrust bool,on_time bool,private_memo text,public_comment text);
      alter table reviews enable row level security;
      insert into jobs values(1,'ブロッコリー','収穫');
      insert into worker_profiles values('${user}','働き手A'); insert into employer_profiles values('${admin}','農家A');
      insert into applications values('${user}',1,'${user}','${admin}','completed',now());
      insert into applications values('${admin}',1,'${user}','${admin}','working',null);
      insert into reviews(id,application_id,direction,created_at,as_described,instructions_clear,pay_status,private_memo,public_comment)
      select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${user}','worker_to_farmer','2026-09-29',true,false,'other','secret','comment' from generate_series(1,32) n;
      insert into reviews(id,application_id,direction,created_at,work_outcome,want_again_choice,traits)
      values('30000000-0000-4000-8000-000000000001','${user}','farmer_to_worker',now(),'partial','neutral','["careful","work_issue"]');
      insert into reviews(id,application_id,direction,created_at) values('30000000-0000-4000-8000-000000000002','${admin}','worker_to_farmer',now());`);
    await db.exec(migration);
    const as = async (id,role='authenticated') => {
      await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec(`set role ${role}`);
    };
    const rpc = async (direction='worker_to_farmer',offset=0) => (await db.query('select public.admin_work_reviews($1,$2) as result',[direction,offset])).rows[0].result;
    await as('', 'anon'); await assert.rejects(rpc(), /permission denied/);
    await as(user); assert.deepEqual(await rpc(),{ok:false,reason:'not_admin'});
    await as(''); assert.deepEqual(await rpc(),{ok:false,reason:'not_admin'});
    await as(admin); const first=await rpc();
    assert.equal(first.ok,true); assert.equal(first.items.length,30); assert.equal(first.has_more,true);
    assert.equal(first.items[0].id,'20000000-0000-4000-8000-000000000032');
    assert.equal(first.items[0].as_described,true); assert.equal(first.items[0].instructions_clear,false);
    assert.equal(first.items[0].safety_care,null); assert.equal(first.items[0].pay_status,'other');
    assert.equal(first.items[0].worker_name,'働き手A');
    assert.equal(JSON.stringify(first).includes('secret'),false); assert.equal(JSON.stringify(first).includes('private_memo'),false);
    assert.equal(JSON.stringify(first).includes('public_comment'),false);
    const second=await rpc('worker_to_farmer',30); assert.equal(second.items.length,2); assert.equal(second.has_more,false);
    assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,32);
    const farmer=await rpc('farmer_to_worker'); assert.equal(farmer.items.length,1);
    assert.equal(farmer.items[0].work_outcome,'partial'); assert.equal(farmer.items[0].want_again_choice,'neutral');
    assert.deepEqual(farmer.items[0].traits,['careful','work_issue']);
    assert.deepEqual(await rpc(null),{ok:false,reason:'bad_input'});
    assert.deepEqual(await rpc('worker_to_farmer',-1),{ok:false,reason:'bad_input'});
    assert.deepEqual(await rpc('invalid'),{ok:false,reason:'bad_input'});
    await assert.rejects(db.query('select * from reviews'),/permission denied/,'admin RPC does not grant raw table access');
  } finally { await db.close(); }
});
