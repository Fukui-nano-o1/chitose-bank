import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.CB_TEST_NODE_MODULES ? `${process.env.CB_TEST_NODE_MODULES}/@electric-sql/pglite` : '@electric-sql/pglite');
const owner='00000000-0000-4000-8000-000000000001', stranger='00000000-0000-4000-8000-000000000002', admin='00000000-0000-4000-8000-000000000003';
const guestToken='a'.repeat(64), wrongToken='b'.repeat(64);
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;

test('support database: real Postgres authorization, retry, diagnostics, threads, limits and retention', async t => {
 const db = new PGlite();
 const rpc = async (name,args) => (await db.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as value`,args)).rows[0].value;
 const login = async uid => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']); await db.exec(`set role ${uid?'authenticated':'anon'}`); };
 const create = (n,token=guestToken,metadata={},body='画面から次へ進めません') => rpc('support_create',[id(n),token,'broken','login','blocked',body,'次へ進む','#/login?email=private@example.com',metadata]);
 const detail = (n,token=guestToken) => rpc('support_detail',[id(n),token]);
 const list = token => rpc('support_list',[token]);
 const reply = (n,message,token=guestToken,reopen=false) => rpc('support_reply',[id(n),token,id(1000+n),message,reopen]);
 const update = (n,version,status,body,request=2000+n) => rpc('admin_support_update',[id(n),version,status,body,id(request)]);
 try {
  await db.exec(`
   create role anon; create role authenticated;
   create schema auth;
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
   create table public.app_admins(auth_id uuid primary key);
   insert into public.app_admins values('${admin}');
   grant select on public.app_admins to authenticated;
   create table public.email_calls(subject text,body text);
   create function public.send_admin_email(subject text,body text) returns void language sql as $$ insert into public.email_calls values(subject,body) $$;
  `);
  for(const name of ['20260714081811_feedback_system.sql','20260815060344_feedback_status_admin_update.sql']) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
  await db.exec(`grant select,insert,update on public.feedback to authenticated;
   insert into public.feedback(id,reporter_id,page_hash,category,body,created_at) values('${id(90)}','${owner}','#/search','confusing','以前の報告',now()-interval '2 years');`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260924144809_support_feedback_flow.sql',import.meta.url),'utf8'));
  await t.test('guest creation is idempotent, produces a receipt, strips all unexpected diagnostics, and sends no email', async()=>{
   await login(null);
   const data=await create(1,guestToken,{page_hash:'#/login?token=secret',captured_at:'2026-09-24T00:00:00.000Z',viewport:{width:390,height:844,password:'secret'},build_id:'abcdef01',online:true,password:'secret',email:'private@example.com',recent_errors:[{at:'2026-09-24T00:00:00.000Z',source:'client',operation:'auth.signInWithOtp',code:'REQUEST_TIMEOUT',message:'secret',email:'private@example.com'},{source:'evil',operation:'private@example.com',code:'my-password'}]});
   assert.equal(data.report.id,id(1)); assert.equal(data.report.page_hash,'#/login');
   assert.equal(data.report.diagnostics.page_hash,'#/login');
   assert.deepEqual(data.report.diagnostics.viewport,{width:390,height:844});
   assert.equal(data.report.diagnostics.recent_errors[1].code,'unknown');
   assert.equal(JSON.stringify(data).includes('secret'),false); assert.equal(JSON.stringify(data).includes('private@example'),false);
   assert.equal(JSON.stringify(data).includes('token_hash'),false); assert.equal(JSON.stringify(data).includes(guestToken),false);
   assert.equal('reporter_id' in data.report,false);
   assert.equal((await create(1)).report.created_at,data.report.created_at);
   assert.equal((await list(guestToken)).items.length,1);
   await db.exec('reset role');
   assert.equal((await db.query('select count(*)::int as n from public.email_calls')).rows[0].n,1); // Only pre-migration fixture.
   assert.equal((await db.query('select count(*)::int as n from private.feedback_guest_access')).rows[0].n,1);
  });
  await t.test('wrong tokens and strangers cannot read, list, reply, mutate, or fetch private hashes',async()=>{
   await login(null);
   assert.deepEqual((await list(wrongToken)).items,[]);
   await assert.rejects(detail(1,wrongToken),/SUPPORT_NOT_FOUND/);
   await assert.rejects(reply(1,'侵入',wrongToken),/SUPPORT_NOT_FOUND/);
   await assert.rejects(create(1,wrongToken),/SUPPORT_NOT_FOUND/);
   await assert.rejects(create(2,'short'),/SUPPORT_BAD_INPUT/);
   await assert.rejects(db.query('select * from public.feedback'),/permission denied/);
   await assert.rejects(db.query('select * from private.feedback_guest_access'),/permission denied/);
   await assert.rejects(db.query('select * from private.feedback_support_actions'),/permission denied/);
   await assert.rejects(update(1,null,'resolved','no'),/permission denied/);
   await login(stranger);
   await assert.rejects(detail(1,wrongToken),/SUPPORT_NOT_FOUND/);
   await assert.rejects(update(1,null,'resolved','no'),/SUPPORT_FORBIDDEN/);
   assert.deepEqual((await db.query('select * from public.feedback')).rows,[]);
  });
  await t.test('signed-in ownership survives browser token rotation; auth reports never grant guest access',async()=>{
   await login(owner);
   const item=await create(2);
   assert.equal(item.report.expected_result,'次へ進む');
   assert.equal((await list(wrongToken)).items.length,2); // Own new report + legacy.
   assert.equal((await detail(90,null)).report.body,'以前の報告');
   await login(null);
   await assert.rejects(detail(2,guestToken),/SUPPORT_NOT_FOUND/);
   await login(stranger);
   await assert.rejects(detail(2,guestToken),/SUPPORT_NOT_FOUND/);
   await login(owner);
   assert.equal((await detail(2,wrongToken)).report.id,id(2));
  });
  await t.test('admin replies, optimistic status locking, and retry identity are atomic',async()=>{
   await login(admin);
   const before=await detail(1,null);
   const changed=await update(1,before.report.updated_at,'answered','確認しました。もう一度お試しください。');
   assert.equal(changed.report.status,'answered'); assert.equal(changed.messages.length,1); assert.equal(changed.messages[0].author_role,'admin');
   const retried=await update(1,before.report.updated_at,'answered','確認しました。もう一度お試しください。');
   assert.equal(retried.messages.length,1); assert.equal(retried.report.updated_at,changed.report.updated_at);
   await assert.rejects(update(1,before.report.updated_at,'resolved','',4001),/SUPPORT_CONFLICT/);
   const checking=await update(1,changed.report.updated_at,'checking','',4002);
   assert.equal(checking.report.status,'checking'); assert.equal(checking.messages.length,1);
   await assert.rejects(update(2,checking.report.updated_at,'resolved','',2001),/SUPPORT_NOT_FOUND/);
  });
  await t.test('owner and guest follow-ups reopen resolved reports once and preserve the thread',async()=>{
   await login(admin);
   const before=await detail(1,null);
   const resolved=await update(1,before.report.updated_at,'resolved','対応しました',4003);
   await login(null);
   const after=await reply(1,'まだ進めません',guestToken,true);
   assert.equal(after.report.status,'open'); assert.equal(after.messages.length,3); assert.equal(after.messages[2].author_role,'user');
   assert.notEqual(after.report.updated_at,resolved.report.updated_at);
   assert.equal((await reply(1,'まだ進めません',guestToken,true)).messages.length,3);
   await assert.rejects(rpc('support_reply',[id(1),guestToken,id(9999),'',true]),/SUPPORT_BAD_INPUT/);
  });
  await t.test('server enforces lengths and topic enums even when the UI is bypassed',async()=>{
   await login(null);
   await assert.rejects(create(3,guestToken,{},'x'.repeat(3001)),/SUPPORT_BAD_INPUT/);
   await assert.rejects(create(3,guestToken,{},' '),/SUPPORT_BAD_INPUT/);
   await assert.rejects(rpc('support_create',[id(3),guestToken,'broken','secret-topic','blocked','body','','#/login',{}]),/SUPPORT_BAD_INPUT/);
   await assert.rejects(create(3,guestToken,{large:'x'.repeat(17000)}),/SUPPORT_BAD_INPUT/);
  });
  await t.test('cached authenticated INSERTs cannot forge statuses, timestamps, or diagnostics',async()=>{
   await login(owner);
   await db.query(`insert into public.feedback(id,reporter_id,page_hash,category,body,status,created_at,updated_at,diagnostics)
    values($1,$2,'#/login?password=secret','broken','古い画面からの報告','resolved',now()-interval '2 years',now()-interval '2 years',$3)`,[id(30),owner,{email:'secret@example.com',viewport:{width:390,height:844}}]);
   const report=(await detail(30,null)).report;
   assert.equal(report.status,'open'); assert.equal(report.page_hash,'#/login');
   assert.ok(Date.now()-Date.parse(report.created_at)<60000);
   assert.equal(JSON.stringify(report).includes('secret'),false);
   await assert.rejects(db.query(`insert into public.feedback(id,reporter_id,page_hash,category,body) values($1,$2,'#/login','broken',$3)`,[id(31),owner,'x'.repeat(3001)]),/SUPPORT_BAD_INPUT/);
   await assert.rejects(db.query(`insert into public.feedback(id,reporter_id,page_hash,category,body) values($1,$2,'#/login','broken','impersonation')`,[id(31),stranger]),/row-level security/);
   await login(admin);
   const before=(await detail(30,null)).report;
   await assert.rejects(update(30,before.updated_at,'answered',''),/SUPPORT_BAD_INPUT/);
  });
  await t.test('per-token and global anonymous create caps stop token rotation; retries still work at cap',async()=>{
   await login(null);
   for(let n=10;n<19;n++) await create(n);
   await assert.rejects(create(19),/SUPPORT_RATE_LIMIT/);
   assert.equal((await create(1)).report.id,id(1));
   await db.exec('reset role');
   await db.exec(`insert into public.feedback(id,reporter_id,page_hash,category,body) select gen_random_uuid(),null,'#/login','broken','global cap fixture' from generate_series(1,290)`);
   await login(null);
   await assert.rejects(create(20,wrongToken),/SUPPORT_RATE_LIMIT/);
   await login(owner);
   assert.equal((await create(20,wrongToken)).report.id,id(20)); // Guest cap does not stop signed-in users.
  });
  await t.test('support functions have safe privileges and no exposed definer wrapper',async()=>{
   await db.exec('reset role');
   const wrappers=(await db.query("select proname,prosecdef,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (proname like 'support_%' or proname='admin_support_update')")).rows;
   assert.equal(wrappers.length,5); assert.ok(wrappers.every(r=>!r.prosecdef));
   assert.ok(wrappers.every(r=>r.proconfig.some(x=>x==='search_path=""')));
   assert.equal((await db.query("select has_table_privilege('anon','private.feedback_guest_access','select') as allowed")).rows[0].allowed,false);
   assert.equal((await db.query("select has_function_privilege('anon','private.cleanup_guest_support()','execute') as allowed")).rows[0].allowed,false);
  });
  await t.test('one-year retention deletes inactive guest cases and cascades, keeping active guests and account history',async()=>{
   await db.exec('reset role');
   // Updating anything ordinarily bumps updated_at; retention fixture deliberately disables that trigger.
   await db.exec(`alter table public.feedback disable trigger feedback_support_touch;
    update public.feedback set updated_at=now()-interval '2 years' where id='${id(1)}';
    update public.feedback set created_at=now()-interval '2 years' where id='${id(10)}';
    alter table public.feedback enable trigger feedback_support_touch;`);
   assert.equal((await db.query('select private.cleanup_guest_support() as n')).rows[0].n,1);
   assert.equal((await db.query(`select count(*)::int as n from private.feedback_guest_access where feedback_id='${id(1)}'`)).rows[0].n,0);
   assert.equal((await db.query(`select count(*)::int as n from private.feedback_support_actions where feedback_id='${id(1)}'`)).rows[0].n,0);
   assert.equal((await db.query(`select count(*)::int as n from public.feedback where id in ('${id(10)}','${id(90)}')`)).rows[0].n,2);
  });
 } finally { await db.close(); }
});
