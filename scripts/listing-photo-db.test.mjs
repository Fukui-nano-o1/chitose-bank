import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const own='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002', worker='00000000-0000-4000-8000-000000000003', admin='00000000-0000-4000-8000-000000000004';
const base='https://aegwepgtmwcnwzybpgsh.supabase.co/storage/v1/object/public/';
const url=n=>base+'job-photos/'+n;
const migration=await readFile(new URL('../supabase/migrations/20261022223639_private_listing_photos.sql',import.meta.url),'utf8');
const anonymousMigration=await readFile(new URL('../supabase/migrations/20261102123651_anonymous_public_job_photos.sql',import.meta.url),'utf8');
test('private listing storage enforces owner, publication, party, and operation boundaries',async t=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
 create function storage.allow_any_operation(ops text[]) returns boolean language sql stable as $$select coalesce(replace(current_setting('storage.operation',true),'storage.','')=any(ops),false)$$;
 grant usage on schema auth,storage to anon,authenticated;
 create table public.app_admins(auth_id uuid primary key);insert into public.app_admins values('${admin}');grant select on public.app_admins to authenticated;
 create table public.jobs(id uuid default gen_random_uuid(),job_number int primary key,farmer_id uuid,status text,headcount int default 1,unlisted_reason text,photos jsonb default '[]',danger_places jsonb default '[]',danger_tasks jsonb default '[]');
 create table public.applications(job_number int,worker_id uuid,status text,terms_confirmed_worker_at timestamptz,terms_confirmed_farmer_at timestamptz);
 create table public.moderated(auth_id uuid);
 create function public.is_account_moderated(id uuid) returns boolean language sql stable as $$select exists(select 1 from public.moderated where auth_id=id)$$;
 create table storage.buckets(id text primary key,public boolean);insert into storage.buckets values('job-photos',true),('consignment-photos',true),('avatars',true);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text);
 alter table storage.objects enable row level security;grant select on storage.objects to anon,authenticated;
 create policy "job-photos authenticated read" on storage.objects for select to authenticated using(bucket_id='job-photos');
 create policy "consignment-photos authenticated read" on storage.objects for select to authenticated using(bucket_id='consignment-photos');
 create policy "job-photos admin write" on storage.objects for all to authenticated using(bucket_id='job-photos' and exists(select 1 from public.app_admins a where a.auth_id=auth.uid())) with check(bucket_id='job-photos' and exists(select 1 from public.app_admins a where a.auth_id=auth.uid()));
 create policy "Anyone can view avatars 1oj01fe_0" on storage.objects for select using(bucket_id='avatars');
 create policy "Users delete own avatar 1oj01fe_1" on storage.objects for select to authenticated using(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
 create policy "farm-timeless authenticated read" on storage.objects for select to authenticated using(bucket_id='farm-timeless');
 create policy "help img read" on storage.objects for select using(bucket_id='help-images');
 alter table public.jobs enable row level security;grant select on public.jobs to authenticated;create policy owner on public.jobs for select to authenticated using(farmer_id=auth.uid());`);
 for(const [n,owner,bucket] of [['draft.jpg',own],['open.jpg',own],['thumb.jpg',own],['danger.jpg',own],['closed.jpg',own],['hidden.jpg',own],['pending.jpg',own],['foreign.jpg',other],['legacy.jpg',admin],['unused-admin.jpg',admin],['consign.jpg',admin,'consignment-photos']])
  await db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',[bucket||'job-photos',n,owner]);
 const add=async(n,status,photos,farmer=own,unlisted=null)=>db.query('insert into public.jobs(job_number,farmer_id,status,photos,unlisted_reason) values($1,$2,$3,$4,$5)',[n,farmer,status,photos,unlisted]);
 await add(1,'draft',[url('draft.jpg')]);await add(2,'open',[{url:url('open.jpg'),thumb:url('thumb.jpg')}]);
 await db.query('update public.jobs set danger_places=$1 where job_number=2',[[{photos:[{url:url('danger.jpg')}]}]]);
 await add(3,'closed',[url('closed.jpg')]);await add(4,'open',[url('hidden.jpg')],own,'owner_unlisted');await add(5,'pending',[url('pending.jpg')]);
 await add(6,'draft',[url('legacy.jpg')]);
 await db.exec(migration);
 const boundary=async()=> (await db.query(`select
  md5(pg_get_functiondef('private.can_read_listing_photo(text,text,text)'::regprocedure)) helper,
  (select proacl::text from pg_proc where oid='private.can_read_listing_photo(text,text,text)'::regprocedure) acl,
  (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='storage' and tablename='objects') policies,
  (select jsonb_agg(to_jsonb(b) order by id) from storage.buckets b) buckets,
  (select relrowsecurity from pg_class where oid='storage.objects'::regclass) rls`)).rows[0];
 const beforeBoundary=await boundary();
 for(const [name,drift] of [
  ['helper definition', 'alter function private.can_read_listing_photo(text,text,text) immutable'],
  ['helper privileges', 'grant execute on function private.can_read_listing_photo(text,text,text) to anon'],
  ['policy roles', 'alter policy "listing photos authorized read" on storage.objects to anon,authenticated'],
  ['policy expression', 'alter policy "listing photos authorized read" on storage.objects using(true)'],
  ['new permissive policy', 'create policy unexpected on storage.objects for select to anon using(true)'],
  ['existing admin bypass', 'alter policy "job-photos admin write" on storage.objects using(true)'],
  ['unrelated-bucket bypass', 'alter policy "help img read" on storage.objects using(true)'],
  ['RLS disabled', 'alter table storage.objects disable row level security'],
  ['public job bucket', "update storage.buckets set public=true where id='job-photos'"],
  ['missing consignment bucket', "delete from storage.buckets where id='consignment-photos'"],
 ]) await t.test('atomic preflight rejects '+name+' drift without applying changes',async()=>{
  await db.exec('begin;'+drift);
  await assert.rejects(db.exec(anonymousMigration),/PHOTO_PREFLIGHT/);
  await db.exec('rollback');
  assert.deepEqual(await boundary(),beforeBoundary);
 });
 await db.exec(anonymousMigration);
 const afterBoundary=await boundary();
 assert.equal(afterBoundary.rls,beforeBoundary.rls);
 assert.deepEqual(afterBoundary.buckets,beforeBoundary.buckets);
 assert.deepEqual(afterBoundary.policies,beforeBoundary.policies.map(p=>p.policyname==='listing photos authorized read'?{...p,roles:['anon','authenticated']}:p));
 // References forged after the one-time migration cannot grant access.
 await add(7,'open',[url('foreign.jpg'),url('unused-admin.jpg')]);
 const login=async(id,op='object.list',role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('storage.operation',$2,false)",[id||'',op]);await db.exec('set role '+role);};
 const names=async()=> (await db.query('select name from storage.objects order by name')).rows.map(r=>r.name);
 await t.test('both media buckets are private; unrelated bucket is unchanged',async()=>{assert.deepEqual((await db.query('select * from storage.buckets order by id')).rows,[{id:'avatars',public:true},{id:'consignment-photos',public:false},{id:'job-photos',public:false}]);});
 await t.test('anonymous downloads only public originals, thumbs and danger photos',async()=>{
  for(const op of ['object.get_authenticated','object.get_authenticated_info']){
   await login(null,op,'anon');assert.deepEqual(await names(),['danger.jpg','open.jpg','thumb.jpg']);
   await assert.rejects(db.query('select * from public.jobs'),/permission denied/);
  }
 });
 await t.test('anonymous cannot enumerate, sign, or use unknown operations',async()=>{
  for(const op of ['', 'object.list','object.list_v2','object.sign','object.sign_many']){
   await login(null,op,'anon');assert.deepEqual(await names(),[]);
  }
 });
 await t.test('anonymous access excludes drafts, pending, unlisted, private closed, consignment and forged references',async()=>{
  await login(null,'object.get_authenticated','anon');
  const n=await names();
  for(const denied of ['draft.jpg','pending.jpg','hidden.jpg','closed.jpg','consign.jpg','foreign.jpg','unused-admin.jpg','legacy.jpg']) assert.ok(!n.includes(denied),denied);
 });
 await t.test('anonymous cannot access private compatibility grants',async()=>{
  await login(null,'object.get_authenticated','anon');
  await assert.rejects(db.query('select * from private.listing_photo_legacy_access'),/permission denied/);
  await assert.rejects(db.query("insert into private.listing_photo_legacy_access values('job-photos','foreign.jpg',$1)",[own]),/permission denied/);
 });
 await t.test('published legacy admin uploads are public only while referenced by a public job',async()=>{
  await db.exec('reset role');await db.exec("update public.jobs set status='open' where job_number=6");
  await login(null,'object.get_authenticated','anon');assert.ok((await names()).includes('legacy.jpg'));
  await db.exec('reset role');await db.exec("update public.jobs set status='draft' where job_number=6");
  await login(null,'object.get_authenticated','anon');assert.ok(!(await names()).includes('legacy.jpg'));
 });
 await t.test('danger task photos use the same exact-reference restriction',async()=>{
  await db.exec('reset role');await db.exec("update public.jobs set danger_tasks=danger_places,danger_places='[]' where job_number=2");
  await login(null,'object.get_authenticated','anon');assert.ok((await names()).includes('danger.jpg'));
  await db.exec('reset role');await db.exec("update public.jobs set danger_places=danger_tasks,danger_tasks='[]' where job_number=2");
 });
 await t.test('owner can list draft, old files and existing administrator-provided photos',async()=>{await login(own);const n=await names();assert.ok(n.includes('draft.jpg'));assert.ok(n.includes('legacy.jpg'));assert.ok(!n.includes('foreign.jpg'));assert.ok(!n.includes('unused-admin.jpg'));});
 await t.test('unrelated member cannot enumerate other people files even if published',async()=>{await login(worker);assert.deepEqual(await names(),[]);});
 await t.test('unknown operation and signing do not open a third-party access path',async()=>{for(const op of ['','object.sign','object.sign_many','object.list','object.list_v2']){await login(worker,op);assert.deepEqual(await names(),[]);}});
 await t.test('published originals, thumbs and danger photos download for members',async()=>{await login(worker,'storage.object.get_authenticated');assert.deepEqual(await names(),['danger.jpg','open.jpg','thumb.jpg']);assert.equal((await db.query('select * from public.jobs')).rows.length,0);});
 await t.test('forged foreign URL and unpublished admin URL never become readable',async()=>{await login(worker,'object.get_authenticated');const n=await names();assert.ok(!n.includes('foreign.jpg'));assert.ok(!n.includes('unused-admin.jpg'));});
 await t.test('non-public closed job is available to a participating applicant',async()=>{await db.exec('reset role');await db.query('insert into public.applications(job_number,worker_id,status) values(3,$1,\'working\')',[worker]);await login(worker,'object.get_authenticated');assert.ok((await names()).includes('closed.jpg'));await login(null,'object.get_authenticated','anon');assert.ok(!(await names()).includes('closed.jpg'));});
 await t.test('cancelled and rejected applications do not preserve private access',async()=>{for(const status of ['cancelled','rejected']){await db.exec('reset role');await db.query('update public.applications set status=$1',[status]);await login(worker,'object.get_authenticated');assert.ok(!(await names()).includes('closed.jpg'));}});
 await t.test('full closed listing follows the existing public visibility condition',async()=>{await db.exec('reset role');await db.exec("update public.applications set status='completed',terms_confirmed_worker_at=now(),terms_confirmed_farmer_at=now()");await login(other,'object.get_authenticated');assert.ok((await names()).includes('closed.jpg'));await login(null,'object.get_authenticated','anon');assert.ok((await names()).includes('closed.jpg'));});
 await t.test('unpublishing and moderation revoke new downloads',async()=>{await db.exec('reset role');await db.exec("update public.jobs set status='draft' where job_number=2");await login(worker,'object.get_authenticated');assert.ok(!(await names()).includes('open.jpg'));await login(null,'object.get_authenticated','anon');assert.ok(!(await names()).includes('open.jpg'));await db.exec('reset role');await db.query('insert into public.moderated values($1)',[own]);await login(other,'object.get_authenticated');assert.ok(!(await names()).includes('closed.jpg'));await login(null,'object.get_authenticated','anon');assert.deepEqual(await names(),[]);});
 await t.test('administrator retains photo maintenance; consignment stays admin-only',async()=>{await login(admin);assert.equal((await names()).length,11);await login(worker,'object.get_authenticated');assert.ok(!(await names()).includes('consign.jpg'));});
 await t.test('admin thumbnail maintenance grants only the intended farmer; ordinary URL pastes cannot grant',async()=>{
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values('job-photos','new-admin-thumb.jpg',$1)",[admin]);
  await db.query('update public.jobs set photos=photos || $1::jsonb where job_number=1',[[{url:url('new-admin-thumb.jpg')}]]);
  await login(own,'object.get_authenticated');assert.ok((await names()).includes('new-admin-thumb.jpg'));
  await login(other,'object.get_authenticated');assert.ok(!(await names()).includes('new-admin-thumb.jpg'));
 });
 await t.test('private grants cannot be read or written by members and no public RPC was added',async()=>{await login(other);await assert.rejects(db.query('select * from private.listing_photo_legacy_access'),/permission denied/);await assert.rejects(db.query(`insert into private.listing_photo_legacy_access values('job-photos','unused-admin.jpg',$1)`,[other]),/permission denied/);await db.exec('reset role');assert.equal((await db.query("select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname like '%listing_photo%'")).rows[0].n,0);});
 }finally{await db.close();}
});
