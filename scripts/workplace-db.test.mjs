import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const sql=await readFile(new URL('../docs/sql/workplace-introduction.candidate.sql',import.meta.url),'utf8');
const own='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002', worker='00000000-0000-4000-8000-000000000003';
const photo=(n,owner=own)=>({id:String(n).padStart(64,'0'),path:`${owner}/${String(n).padStart(64,'0')}.jpg`});
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);insert into auth.users values('${own}'),('${other}'),('${worker}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function storage.allow_any_operation(ops text[]) returns boolean language sql stable as $$select coalesce(replace(current_setting('storage.operation',true),'storage.','')=any(ops),false)$$;
 grant usage on schema auth,storage to anon,authenticated;
 create table public.employer_profiles(auth_id uuid primary key);insert into public.employer_profiles values('${own}'),('${other}');
 create table public.jobs(job_number integer primary key,farmer_id uuid,status text,unlisted_reason text,headcount integer default 1);
 insert into public.jobs values(101,'${own}','open',null,1),(102,'${own}','draft',null,1),(103,'${own}','open','hidden',1),(104,'${own}','closed',null,1),(201,'${other}','open',null,1);
 create table public.applications(job_number integer,terms_confirmed_worker_at timestamptz,terms_confirmed_farmer_at timestamptz);
 create table public.moderated(auth_id uuid);
 create function public.is_account_moderated(id uuid) returns boolean language sql stable as $$select exists(select 1 from public.moderated where auth_id=id)$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 insert into storage.buckets values('job-photos','job-photos',false,null,null);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;grant select on storage.objects to anon;
 create policy unrelated on storage.objects for all to authenticated using(bucket_id='job-photos') with check(bucket_id='job-photos');
 `);
 return db;
}
async function login(db,id=own,op='object.get_authenticated',role='authenticated'){
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('storage.operation',$2,false)",[id||'',op]);await db.exec('set role '+role);
}
const rpc=async(db,name,args)=> (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
const objects=async(db)=> (await db.query("select name from storage.objects where bucket_id='workplace-photos' order by name")).rows.map(r=>r.name);
async function upload(db,p,owner=own){await rpc(db,'reserve_workplace_photo',[owner,p.id,p.id]);const r=await db.query("insert into storage.objects(bucket_id,name,owner_id) values('workplace-photos',$1,$2)",[p.path,owner]);await rpc(db,'finalize_workplace_photo',[owner,p.id]);return r;}

test('independent workplace candidate is fail-closed, owner-scoped and publishes only explicit immutable photos',async t=>{
 const db=await setup();try{
 await t.test('candidate refuses ordinary application without changing schema',async()=>{
  await assert.rejects(db.exec(sql),/WORKPLACE_CANDIDATE_NOT_APPROVED/);await db.exec('rollback');
  assert.equal((await db.query("select to_regclass('private.employer_workplaces') t")).rows[0].t,null);
 });
 await db.exec("set workplace.synthetic_candidate='local-tests-only'");await db.exec(sql);
 await t.test('private bucket and denied raw table; ordinary owner writes without admin privilege',async()=>{
  assert.equal((await db.query("select public from storage.buckets where id='workplace-photos'")).rows[0].public,false);
  await login(db);await assert.rejects(db.query('select * from private.employer_workplaces'),/permission denied/);
  assert.deepEqual(await rpc(db,'read_my_workplace',[own]),{ok:true,row:null});
  await upload(db,photo(1));await upload(db,photo(2));
  const r=await rpc(db,'save_my_workplace',[own,0,JSON.stringify([photo(1)])]);assert.equal(r.ok,true);assert.equal(r.row.revision,1);assert.deepEqual(r.row.published_photos,[]);
 });
 await t.test('other user and non-employer cannot impersonate owner or upload there',async()=>{
  await login(db,other);assert.equal((await rpc(db,'read_my_workplace',[own])).ok,false);
  assert.equal((await rpc(db,'save_my_workplace',[own,1,'[]'])).reason,'not_allowed');
  await assert.rejects(upload(db,photo(3),own),/row-level security|WORKPLACE_UPLOAD_NOT_RESERVED/);
  await login(db,worker);assert.equal((await rpc(db,'save_my_workplace',[worker,0,'[]'])).reason,'not_allowed');
  await assert.rejects(upload(db,photo(3,worker),worker),/row-level security|WORKPLACE_UPLOAD_NOT_RESERVED/);
 });
 await t.test('failed nonzero initial baseline does not create a record',async()=>{
  await login(db,other);assert.equal((await rpc(db,'save_my_workplace',[other,5,'[]'])).reason,'conflict');
  assert.equal((await rpc(db,'read_my_workplace',[other])).row,null);
 });
 await t.test('strict photo shape, existence, own namespace, count and CAS',async()=>{
  await login(db);assert.equal((await rpc(db,'save_my_workplace',[own,0,'[]'])).reason,'conflict');
  for(const bad of [[photo(3)],[photo(1),photo(1)],[photo(1,other)],[{...photo(1),caption:'unreviewed'}],[{...photo(1),id:'no'}],Array.from({length:7},(_,i)=>photo(i+1)),{url:'job-photos/x'}]){
   assert.equal((await rpc(db,'save_my_workplace',[own,1,JSON.stringify(bad)])).reason,'invalid_photos');
  }
  assert.equal((await rpc(db,'read_my_workplace',[own])).row.revision,1);
 });
 await t.test('draft never public and neither consent may be omitted',async()=>{
  await login(db,null,'object.get_authenticated','anon');assert.deepEqual(await objects(db),[]);assert.equal(await rpc(db,'job_workplace',[101]),null);
  await assert.rejects(rpc(db,'read_my_workplace',[own]),/permission denied/);
  await login(db);for(const consents of [[false,true],[true,false],[null,true],[true,null]])assert.equal((await rpc(db,'publish_my_workplace',[own,1,...consents])).reason,'consent_required');
  const r=await rpc(db,'publish_my_workplace',[own,1,true,true]);assert.equal(r.ok,true);assert.equal(r.row.revision,2);assert.ok(r.row.image_consent_at&&r.row.people_consent_at);
 });
 await t.test('published projection excludes draft/private row columns; only eligible exact job',async()=>{
  await login(db,null,'object.get_authenticated','anon');assert.deepEqual(await objects(db),[photo(1).path]);
  const r=await rpc(db,'job_workplace',[101]);assert.deepEqual(Object.keys(r).sort(),['photos','published_at']);assert.deepEqual(r.photos,[photo(1)]);
  for(const id of [102,103,104,201,999])assert.equal(await rpc(db,'job_workplace',[id]),null);
  await db.exec('reset role');await db.exec("insert into public.applications values(104,now(),now())");
  await login(db,null,'object.get_authenticated','anon');assert.deepEqual((await rpc(db,'job_workplace',[104])).photos,[photo(1)]);
 });
 await t.test('owner and visitor cannot list/sign; restrictive fence resists unrelated broad grants',async()=>{
  await db.exec('reset role');await db.exec('create policy accidental_broad on storage.objects for all to public using(true) with check(true)');
  for(const who of [null,own,other])for(const op of ['object.list','object.list_v2','object.sign','object.sign_many','', 'unknown']){
   await login(db,who,op,who?'authenticated':'anon');assert.deepEqual(await objects(db),[]);
  }
  await login(db,other);assert.deepEqual(await objects(db),[photo(1).path]);await assert.rejects(upload(db,photo(8),own),/row-level security|WORKPLACE_UPLOAD_NOT_RESERVED/);
  await login(db);assert.equal((await db.query("update storage.objects set name=$1 where bucket_id='workplace-photos' returning name",[photo(9).path])).rows.length,0);
 });
 await t.test('draft edits retain published version; hard deletion is denied even for unreferenced owner objects',async()=>{
  await login(db);const r=await rpc(db,'save_my_workplace',[own,2,JSON.stringify([photo(2)])]);assert.equal(r.row.revision,3);assert.deepEqual(r.row.published_photos,[photo(1)]);
  await login(db,own,'object.delete_many');for(const p of [photo(1),photo(2)])assert.equal((await db.query("delete from storage.objects where bucket_id='workplace-photos' and name=$1 returning name",[p.path])).rows.length,0);
  await login(db);await upload(db,photo(4));
  assert.equal((await db.query("delete from storage.objects where bucket_id='workplace-photos' and name=$1 returning name",[photo(4).path])).rows.length,0,'restrictive DELETE fence denies even when SELECT operation permits the row');
  await login(db,own,'object.delete_many');assert.equal((await db.query("delete from storage.objects where bucket_id='workplace-photos' and name=$1 returning name",[photo(4).path])).rows.length,0);
  await login(db);const next=await rpc(db,'publish_my_workplace',[own,3,true,true]);assert.equal(next.row.revision,4);
  await login(db,own,'object.delete_many');assert.equal((await db.query("delete from storage.objects where bucket_id='workplace-photos' and name=$1 returning name",[photo(1).path])).rows.length,0);
 });
 await t.test('unpublish clears public references, retains draft and does not authorize hard deletion',async()=>{
  await login(db);await upload(db,photo(5));
  const draft=await rpc(db,'save_my_workplace',[own,4,JSON.stringify([photo(5)])]);assert.equal(draft.row.revision,5);
  assert.equal((await rpc(db,'unpublish_my_workplace',[own,4])).reason,'conflict');
  const r=await rpc(db,'unpublish_my_workplace',[own,5]);assert.equal(r.row.revision,6);assert.deepEqual(r.row.draft_photos,[photo(5)]);
  assert.deepEqual(r.row.published_photos,[]);assert.equal(r.row.published_at,null);assert.equal(r.row.publication_active,false);
  assert.equal(r.row.consent_version,null);assert.equal(r.row.image_consent_at,null);assert.equal(r.row.people_consent_at,null);
  await login(db,null,'object.get_authenticated','anon');assert.deepEqual(await objects(db),[]);assert.equal(await rpc(db,'job_workplace',[101]),null);
  await login(db,own,'object.delete_many');
  assert.equal((await db.query("delete from storage.objects where bucket_id='workplace-photos' and name=$1 returning name",[photo(2).path])).rows.length,0,'former published-only bytes remain private and retained');
  assert.equal((await db.query("delete from storage.objects where bucket_id='workplace-photos' and name=$1 returning name",[photo(5).path])).rows.length,0,'draft bytes remain protected');
 });
 await t.test('new publication requires fresh consent and moderation denies public downloads and writes',async()=>{
  await login(db);assert.equal((await rpc(db,'publish_my_workplace',[own,6,true,false])).reason,'consent_required');
  assert.equal((await rpc(db,'publish_my_workplace',[own,6,true,true])).ok,true);
  await db.exec('reset role');await db.query('insert into public.moderated values($1)',[own]);
  await login(db,null,'object.get_authenticated','anon');assert.deepEqual(await objects(db),[]);assert.equal(await rpc(db,'job_workplace',[101]),null);
  await login(db);assert.equal((await rpc(db,'save_my_workplace',[own,7,'[]'])).reason,'not_allowed');
 });
 await t.test('unrelated bucket behavior remains unchanged',async()=>{
  await login(db,other);await db.exec("insert into storage.objects(bucket_id,name,owner_id) values('job-photos','existing-scope','fixture')");
  assert.equal((await db.query("update storage.objects set name='existing-updated' where bucket_id='job-photos' returning name")).rows.length,1);
  assert.equal((await db.query("delete from storage.objects where bucket_id='job-photos' returning name")).rows.length,1);
 });
 await t.test('candidate serializes record mutations and gates non-default isolation',async()=>{
  assert.match(sql,/for update/);assert.match(sql,/unsupported_isolation/);
  assert.match(sql,/guard_workplace_photo_insert/);
 });
 }finally{await db.close();}
});

test('production review guard is body-identical and refuses project/catalog drift without changes',async t=>{
 const migrationNames=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(name=>/^\d+_independent_workplace_introduction\.sql$/.test(name));
 assert.equal(migrationNames.length,1,'one canonical applied workplace migration');
 const review=await readFile(new URL('../supabase/migrations/'+migrationNames[0],import.meta.url),'utf8');
 const metadata=Object.fromEntries(['first','second'].map(key=>[key,JSON.parse(review.split(`$expected_${key}$`)[1])]));
 const queries=[...review.matchAll(/select jsonb_build_object\([\s\S]*?\) into actual;/g)].map(match=>match[0].replace(/ into actual;$/,' as metadata'));
 assert.equal(queries.length,2,'both catalog checks are extracted from the canonical SQL');
 const marker='create schema if not exists private;';
 assert.equal(review.slice(review.indexOf(marker)),sql.slice(sql.indexOf(marker)));
 assert.match(review,/set local lock_timeout = '5s'/);
 assert.match(review,/lock table storage.objects, storage.buckets in share row exclusive mode/);
 for(const [i,key] of ['first','second'].entries()){
  assert.ok(review.includes(queries[i].trim().replace(/ as metadata$/,' into actual;')));
  assert.ok(review.includes(`$expected_${key}$${JSON.stringify(metadata[key])}$expected_${key}$::jsonb`));
 }
 const db=await setup();try{
  const unchanged=async()=>{
   await db.exec('rollback');
   assert.equal((await db.query("select to_regclass('private.employer_workplaces') t")).rows[0].t,null);
   assert.equal((await db.query("select count(*)::integer n from storage.buckets where id='workplace-photos'")).rows[0].n,0);
   assert.equal((await db.query("select count(*)::integer n from pg_proc where proname='save_my_workplace'")).rows[0].n,0);
  };
  await t.test('unaltered production SQL refuses synthetic project',async()=>{
   await assert.rejects(db.exec(review),/WORKPLACE_PROJECT_FINGERPRINT_MISMATCH/);await unchanged();
  });
  // Fixture-only substitutions exercise each later guard. Never written to SQL artifact.
  await db.exec("create schema private;create function private.can_read_listing_photo() returns text language sql as $$select 'aegwepgtmwcnwzybpgsh.supabase.co'::text$$");
  const hash=(await db.query("select md5(pg_get_functiondef('private.can_read_listing_photo()'::regprocedure)) h")).rows[0].h;
  const fixture=review.replace(metadata.second.photo_helper.hash,hash);
  await t.test('matching fixture project still refuses first catalog drift',async()=>{
   await assert.rejects(db.exec(fixture),/WORKPLACE_METADATA_FIRST_MISMATCH/);await unchanged();
  });
  const first=(await db.query(queries[0])).rows[0].metadata;
  const secondFixture=fixture.replace(`$expected_first$${JSON.stringify(metadata.first)}$expected_first$`,`$expected_first$${JSON.stringify(first)}$expected_first$`);
  await t.test('matching fixture first snapshot still refuses second catalog drift',async()=>{
   await assert.rejects(db.exec(secondFixture),/WORKPLACE_METADATA_SECOND_MISMATCH/);await unchanged();
  });
 }finally{await db.close();}
});

test('owner photo library reservations, explicit deletion and logical quota',async t=>{
 const db=await setup();try{
  await db.exec("set workplace.synthetic_candidate='local-tests-only'");await db.exec(sql);await login(db);
  const reserve=(n,hash=photo(n).id)=>rpc(db,'reserve_workplace_photo',[own,photo(n).id,hash]);
  const prepare=(n,confirm=true)=>rpc(db,'prepare_delete_workplace_photo',[own,photo(n).id,confirm]);
  const finish=(n)=>rpc(db,'finalize_delete_workplace_photo',[own,photo(n).id]);
  await t.test('pending survives unknown upload and is visible only to owner',async()=>{
   assert.equal((await reserve(1)).photo.state,'pending');
   assert.equal((await reserve(1)).photo.state,'pending');
   assert.equal((await reserve(1,photo(2).id)).reason,'hash_mismatch');
   assert.equal((await rpc(db,'finalize_workplace_photo',[own,photo(1).id])).reason,'upload_pending');
   assert.equal((await rpc(db,'read_my_workplace_photos',[own])).photos.length,1);
   await login(db,other);assert.equal((await rpc(db,'read_my_workplace_photos',[own])).reason,'not_owner');
   await login(db,null,'object.list','anon');await assert.rejects(rpc(db,'read_my_workplace_photos',[own]),/permission denied/);
   await login(db);
  });
  await t.test('draft and published refs both prevent explicit deletion',async()=>{
   await upload(db,photo(1));await upload(db,photo(2));
   await rpc(db,'save_my_workplace',[own,0,JSON.stringify([photo(1)])]);
   assert.equal((await prepare(1,false)).reason,'confirmation_required');
   assert.equal((await prepare(1)).reason,'in_use');
   await rpc(db,'publish_my_workplace',[own,1,true,true]);
   await rpc(db,'save_my_workplace',[own,2,JSON.stringify([photo(2)])]);
   assert.equal((await prepare(1)).reason,'in_use');assert.equal((await prepare(2)).reason,'in_use');
   await rpc(db,'unpublish_my_workplace',[own,3]);
  });
  await t.test('deleting is irreversible, unreferenceable and retryable until Storage succeeds',async()=>{
   assert.equal((await prepare(1)).photo.state,'deleting');
   assert.equal((await prepare(1)).photo.state,'deleting');
   assert.equal((await reserve(1)).reason,'deleting');
   assert.equal((await rpc(db,'save_my_workplace',[own,4,JSON.stringify([photo(1)])])).reason,'invalid_photos');
   assert.equal((await finish(1)).reason,'delete_pending');
   await login(db,other,'object.delete_many');assert.equal((await db.query("delete from storage.objects where name=$1 returning name",[photo(1).path])).rows.length,0);
   await login(db,own,'object.list');assert.deepEqual(await objects(db),[]);
   await login(db,own,'object.delete_many');
   // Synthetic metadata deletion represents Storage API's authorized DB phase only.
   assert.equal((await db.query("delete from storage.objects where name=$1 returning name",[photo(1).path])).rows.length,1);
   assert.equal((await finish(1)).photo.state,'deleted');assert.equal((await finish(1)).photo.state,'deleted');
   assert.equal((await reserve(1)).reason,'deleted');
   assert.equal((await reserve(3,photo(1).id)).photo.state,'pending'); // same bytes, fresh asset ID
   await assert.rejects(db.query("insert into storage.objects(bucket_id,name,owner_id) values('workplace-photos',$1,$2)",[photo(1).path,own]),/WORKPLACE_UPLOAD_NOT_RESERVED/);
  });
  await t.test('pending and deleting count toward unique 24-slot cap; explicit removal frees one',async()=>{
   await login(db);for(let n=4;n<=25;n++) assert.equal((await reserve(n)).ok,true);
   assert.equal((await reserve(26)).reason,'quota_exceeded');
   const library=await rpc(db,'read_my_workplace_photos',[own]);assert.equal(library.photos.length,24);assert.equal(new Set(library.photos.map(p=>p.slot)).size,24);
   assert.equal((await prepare(3)).photo.state,'deleting');assert.equal((await reserve(26)).reason,'quota_exceeded');
   assert.equal((await finish(3)).photo.state,'deleted');assert.equal((await reserve(26)).ok,true);
   await db.exec('reset role');await assert.rejects(db.query("insert into private.workplace_photo_library(owner_id,id,content_hash,path,slot,state) values($1,$2,$2,$3,1,'pending')",[own,photo(99).id,photo(99).path]),/unique constraint/);
  });
  await t.test('non-default snapshots cannot perform reference/deletion mutations',async()=>{
   await login(db);await db.exec('begin isolation level repeatable read');
   assert.equal((await prepare(26)).reason,'unsupported_isolation');assert.equal((await reserve(27)).reason,'unsupported_isolation');
   assert.equal((await rpc(db,'save_my_workplace',[own,4,'[]'])).reason,'unsupported_isolation');await db.exec('rollback');
  });
 }finally{await db.close();}
});
