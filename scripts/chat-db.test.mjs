import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.CB_TEST_NODE_MODULES?`${process.env.CB_TEST_NODE_MODULES}/@electric-sql/pglite`:'@electric-sql/pglite');
const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',stranger='10000000-0000-4000-8000-000000000003';
const app='20000000-0000-4000-8000-000000000001',privateApp='20000000-0000-4000-8000-000000000002';
test('inbox previews return one bounded latest message per permitted application under real Postgres RLS',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
 create table applications(id uuid primary key,worker_id uuid,farmer_id uuid);
 create table messages(id uuid primary key default gen_random_uuid(),application_id uuid,sender_id uuid,body text,created_at timestamptz default now());
 alter table applications enable row level security; alter table messages enable row level security;
 create policy apps_read on applications for select to authenticated using(worker_id=auth.uid() or farmer_id=auth.uid());
 create policy msgs_read on messages for select to authenticated using(exists(select from applications a where a.id=application_id));
 grant select on applications,messages to authenticated;
 insert into applications values('${app}','${owner}','${other}'),('${privateApp}','${stranger}','${stranger}');
 insert into messages(application_id,sender_id,body,created_at) select '${app}','${other}','older-'||n,now()-interval '1 day' from generate_series(1,1200) n;
 insert into messages(application_id,sender_id,body,created_at) values('${app}','${other}',repeat('新',500),now()),('${privateApp}','${stranger}','private',now());`);
 await db.exec(await readFile(new URL('../supabase/migrations/20260924151645_chat_inbox_previews.sql',import.meta.url),'utf8'));
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
 const data=(await db.query('select * from my_chat_inbox_previews()')).rows;
 assert.equal(data.length,1);assert.equal(data[0].application_id,app);assert.equal(data[0].body,'新'.repeat(240));
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[stranger]);await db.exec('set role authenticated');
 const isolated=(await db.query('select * from my_chat_inbox_previews()')).rows;assert.equal(isolated.length,1);assert.equal(isolated[0].body,'private');
 await db.exec('reset role;set role anon');await assert.rejects(()=>db.query('select * from my_chat_inbox_previews()'),/permission denied/);
 }finally{await db.close();}
});
