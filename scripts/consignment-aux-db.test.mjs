import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('consignment auxiliary writes preserve concurrent input and replay existing IDs',async t=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table app_admins(auth_id uuid primary key);insert into app_admins values('${owner}');grant select on app_admins to authenticated;
   create table consignment_profiles(auth_id uuid primary key,consignor_data jsonb not null default '{}',consignment_terms_consent boolean not null default false,consignment_terms_consent_at timestamptz,consignment_terms_consent_version text not null default '',consignment_terms_consent_user_id uuid,updated_at timestamptz not null default now());
   create table consignment_fields(id uuid primary key,auth_id uuid not null,name text not null,region text not null default '',area_a text not null default '',data jsonb not null default '{}',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(auth_id,name));
   create table consignment_deals(id uuid primary key,status text not null default 'draft',spec jsonb not null default '{}',spec_snapshot jsonb,snapshot_at timestamptz,agreed_at date,inspected_at date,paid_at date,notes text,updated_at timestamptz not null default now());
   create table consignment_progress(id uuid primary key,deal_id uuid not null references consignment_deals(id),work_date date not null,hours numeric,workers integer,yield_boxes integer,note text,created_at timestamptz not null default now());
   insert into consignment_deals(id,spec) values('${id(1)}','{"photos":["a"],"keep":"original"}');
   create function touch_updated_at() returns trigger language plpgsql as $$begin new.updated_at:=now();return new;end$$;
   create trigger consignment_touch before update on consignment_deals for each row execute function touch_updated_at();
   create function freeze() returns trigger language plpgsql as $$begin if new.status='agreed' and old.status is distinct from 'agreed' then if new.spec_snapshot is null then new.spec_snapshot:=new.spec;new.snapshot_at:=now();end if;if new.agreed_at is null then new.agreed_at:=(now() at time zone 'Asia/Tokyo')::date;end if;end if;return new;end$$;
   create trigger trg_consign_freeze_spec before update on consignment_deals for each row execute function freeze();`);
  for(const table of ['consignment_profiles','consignment_fields','consignment_deals','consignment_progress'])await db.exec(`alter table ${table} enable row level security;create policy admin_only on ${table} for all to authenticated using(exists(select 1 from app_admins where auth_id=auth.uid())) with check(exists(select 1 from app_admins where auth_id=auth.uid()));grant select,insert,update,delete on ${table} to authenticated;`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261018155131_consignment_aux_compare_and_save.sql',import.meta.url),'utf8'));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
  const call=async(op,key,input,expected=null,who=owner)=>(await db.query('select save_my_consignment_aux($1,$2,$3,$4,$5) r',[who,op,key,expected,input])).rows[0].r;
  const deal=async()=>(await db.query('select to_jsonb(d) r from consignment_deals d where id=$1',[id(1)])).rows[0].r;
  const base=row=>Object.fromEntries(['name','region','area_a','data','updated_at'].map(k=>[k,row[k]]));
  await t.test('field create replay is one row; stale edit/delete never erases another change',async()=>{
   const input={name:'試験圃場',region:'住所',area_a:'10',data:{photo:'shared',keep:'legacy'}};
   const a=await call('field_save',id(2),input);assert.equal(a.ok,true);assert.equal((await call('field_save',id(2),input)).ok,true);assert.equal((await db.query('select count(*)::int n from consignment_fields')).rows[0].n,1);
   const b=await call('field_save',id(2),{...input,region:'new'},base(a.row));assert.equal(b.ok,true);
   assert.equal((await call('field_save',id(2),{...input,name:'stale'},base(a.row))).reason,'conflict');assert.equal((await call('field_delete',id(2),{},base(a.row))).reason,'conflict');
   assert.equal((await call('field_delete',id(2),{},base(b.row))).ok,true);assert.equal((await call('field_delete',id(2),{},base(b.row))).ok,true);
  });
  await t.test('lending updates only its JSON key and rejects a stale catalog; terms consent is separate and idempotent',async()=>{
   await db.exec(`insert into consignment_profiles(auth_id,consignor_data) values('${owner}','{"cmn_pay_due":"保持"}');`);
   const items=[{k:'道具',n:'かま'}],a=await call('lend',owner,{items});assert.equal(a.ok,true);assert.equal(a.row.consignor_data.cmn_pay_due,'保持');assert.equal((await call('lend',owner,{items})).ok,true);
   assert.equal((await call('lend',owner,{items:[{k:'設備',n:'stale'}]})).reason,'conflict');
   const terms={version:'consignment-terms-v1-2026-08'},b=await call('terms',owner,terms),c=await call('terms',owner,terms);assert.equal(b.ok,true);assert.equal(c.row.consignment_terms_consent_at,b.row.consignment_terms_consent_at);assert.deepEqual(c.row.consignor_data,a.row.consignor_data);
  });
  await t.test('state changes preserve snapshot/spec, replay without changes, and reject stale transitions',async()=>{
   const value=action=>({action,date:'2026-10-18',note:action==='complete'?'振返り':action==='inspect'?'検収':''});
   let row=await deal();const agreed=await call('advance',id(1),value('agree'),{updated_at:row.updated_at});assert.equal(agreed.ok,true);assert.deepEqual(agreed.row.spec_snapshot,row.spec);row=agreed.row;
   const deposit=await call('advance',id(1),value('deposit'),{updated_at:row.updated_at});assert.equal(deposit.ok,true);assert.equal(deposit.row.spec.deposit_received_at,'2026-10-18');assert.equal(deposit.row.spec.keep,'original');row=deposit.row;
   for(const action of ['start','inspect','pay','complete']){const before=row,r=await call('advance',id(1),value(action),{updated_at:row.updated_at});assert.equal(r.ok,true,JSON.stringify(r));row=r.row;assert.deepEqual((await call('advance',id(1),value(action),{updated_at:before.updated_at})).row,row);}
   assert.equal(row.status,'done');assert.equal(row.spec.reflection,'振返り');assert.deepEqual(row.spec_snapshot,agreed.row.spec_snapshot);assert.equal((await call('advance',id(1),value('start'),{updated_at:agreed.row.updated_at})).reason,'conflict');
  });
  await t.test('progress same ID is one row, changed input is rejected, invalid numbers do not write',async()=>{
   const input={deal_id:id(1),work_date:'2026-10-18',hours:6.5,workers:2,yield_boxes:10,note:'進捗'};
   assert.equal((await call('progress',id(3),input)).ok,true);assert.equal((await call('progress',id(3),input)).ok,true);assert.equal((await call('progress',id(3),{...input,hours:7})).reason,'conflict');assert.equal((await call('progress',id(4),{...input,workers:2.5})).ok,false);assert.equal((await db.query('select count(*)::int n from consignment_progress')).rows[0].n,1);
  });
  await t.test('zero-row and altered inserts roll back rather than return a successful or partially written progress',async()=>{
   await db.exec(`reset role;create function qa_skip_progress() returns trigger language plpgsql as $$begin if new.note='skip' then return null;end if;if new.note='alter' then new.note:='changed';end if;return new;end$$;create trigger qa_skip_progress before insert on consignment_progress for each row execute function qa_skip_progress();set role authenticated;`);
   for(const [n,note] of [[8,'skip'],[9,'alter']]){const r=await call('progress',id(n),{deal_id:id(1),work_date:'2026-10-18',hours:1,workers:null,yield_boxes:null,note});assert.equal(r.reason,'save_rejected');}
   assert.equal((await db.query('select count(*)::int n from consignment_progress')).rows[0].n,1);
  });
  await t.test('anonymous, nonadmin and owner mismatch cannot write',async()=>{
   assert.equal((await call('terms',owner,{version:'consignment-terms-v1-2026-08'},null,other)).ok,false);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);assert.equal((await call('terms',other,{version:'consignment-terms-v1-2026-08'},null,other)).reason,'forbidden');await db.exec('set role anon');await assert.rejects(call('terms',owner,{}),/permission denied/);
  });
 }finally{await db.close();}
});
