import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const own='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const base=r=>Object.fromEntries(['spec','status','notes','updated_at'].map(k=>[k,r[k]]));
test('consignment bundle executes actual SQL with atomic failure and immutable receipts',async t=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      create table public.app_admins(auth_id uuid primary key);insert into public.app_admins values('${own}');grant select on public.app_admins to authenticated;`);
    for(const file of ['./fixtures/consignor-prod-schema.sql','./fixtures/consignment-deal-prod-schema.sql','../supabase/migrations/20261018145244_consignment_deal_atomic_save.sql'])await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
    for(const table of ['consignment_deals','consignment_fields','consignment_profiles'])await db.exec(`alter table public.${table} enable row level security;
      create policy admin_all on public.${table} for all to authenticated using(exists(select 1 from public.app_admins where auth_id=auth.uid())) with check(exists(select 1 from public.app_admins where auth_id=auth.uid()));
      grant select,insert,update on public.${table} to authenticated;`);
    await db.exec(`create function public.qa_bundle_failure() returns trigger language plpgsql as $$begin
      if current_setting('qa.fail_table',true)=tg_table_name then raise exception 'injected failure';end if;return new;end$$;`);
    for(const table of ['public.consignment_deals','public.consignment_fields','public.consignment_profiles','private.consignment_save_requests'])await db.exec(`create trigger qa_failure before insert or update on ${table} for each row execute function public.qa_bundle_failure();`);
    const login=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
    const admin=async(sql,args=[])=>{await db.exec('reset role');try{return await db.query(sql,args);}finally{await login(own);}};
    const request=(overrides={})=>({owner:own,request:randomUUID(),id:randomUUID(),expected:null,patch:{spec:{field_name:'test field',area_a:'30',region:'coarse region',photos:[{url:'1'},{url:'2'},{url:'3'}]},status:'draft',notes:null},field:null,terms:{cmn_pay_due:'7日'},...overrides});
    const call=async q=>(await db.query('select public.save_my_consignment_bundle($1,$2,$3,$4,$5,$6,$7) r',[q.owner,q.request,q.id,q.expected,q.patch,q.field,q.terms])).rows[0].r;
    const counts=async()=>(await admin(`select (select count(*)::int from public.consignment_deals) deals,(select count(*)::int from public.consignment_fields) fields,(select count(*)::int from public.consignment_profiles) profiles,(select count(*)::int from private.consignment_save_requests) receipts`)).rows[0];
    await login(own);
    for(const table of ['consignment_deals','consignment_fields','consignment_profiles','consignment_save_requests'])await t.test(table+' failure rolls back every earlier write',async()=>{
      await db.query("select set_config('qa.fail_table',$1,false)",[table]);
      const r=await call(request());assert.equal(r.reason,'save_rejected');assert.deepEqual(await counts(),{deals:0,fields:0,profiles:0,receipts:0});
      await db.query("select set_config('qa.fail_table','',false)");
    });
    let q,receipt;
    await t.test('normal save commits all four records; same request is exactly idempotent',async()=>{
      q=request();receipt=await call(q);assert.equal(receipt.ok,true);assert.equal(receipt.field.auth_id,own);assert.equal(receipt.profile.consignor_data.cmn_pay_due,'7日');
      assert.deepEqual(await counts(),{deals:1,fields:1,profiles:1,receipts:1});assert.deepEqual(await call(q),receipt);assert.deepEqual(await counts(),{deals:1,fields:1,profiles:1,receipts:1});
      assert.equal((await call({...q,patch:{...q.patch,notes:'modified retry'}})).reason,'request_mismatch');
    });
    await t.test('formal field address/equipment and unrelated profile keys survive',async()=>{
      await admin("update public.consignment_fields set region='formal address',data='{\"zip\":\"123\",\"photo\":\"keep\"}'");
      await admin("update public.consignment_profiles set consignor_data=consignor_data||'{\"cmn_lend_items\":[\"tool\"]}',nickname='keep'");
      const r=await call(request({id:q.id,expected:base(receipt.row),field:{area_a:'30'},patch:{...q.patch,spec:{...q.patch.spec,area_a:'40'}},terms:{cmn_inspect:'3日'}}));
      assert.equal(r.ok,true);assert.equal(r.field.region,'formal address');assert.deepEqual(r.field.data,{zip:'123',photo:'keep'});assert.deepEqual(r.profile.consignor_data.cmn_lend_items,['tool']);assert.equal(r.profile.nickname,'keep');
    });
    await t.test('stale second-device update cannot overwrite the first device',async()=>{
      const before=await counts();assert.equal((await call(request({id:q.id,expected:base(receipt.row),patch:{...q.patch,notes:'stale'}}))).reason,'conflict');assert.deepEqual(await counts(),before);
    });
    await t.test('response-loss replay returns original receipt even after later edits',async()=>{
      assert.deepEqual(await call(q),receipt);
      const live=(await db.query('select spec from public.consignment_deals where id=$1',[q.id])).rows[0];assert.equal(live.spec.area_a,'40');
    });
    await t.test('competing field and standard term inputs reject the whole bundle',async()=>{
      const before=await counts();assert.equal((await call(request())).reason,'field_conflict');
      assert.equal((await call(request({field:{area_a:'40'},terms:{cmn_pay_due:'another deadline'}}))).reason,'terms_conflict');
      assert.deepEqual(await counts(),before);
    });
    await t.test('deleted target is not recreated; trigger freezes agreement once',async()=>{
      assert.equal((await call(request({expected:base(receipt.row)}))).reason,'not_found');
      const current=(await db.query('select * from public.consignment_deals where id=$1',[q.id])).rows[0];
      const r=await call(request({id:q.id,expected:base(current),field:{area_a:'40'},patch:{spec:current.spec,status:'agreed',notes:'agreement'},terms:{}}));
      assert.equal(r.ok,true);assert.deepEqual(r.row.spec_snapshot,current.spec);assert.ok(r.row.snapshot_at);assert.ok(r.row.agreed_at);
    });
    await t.test('owner mismatch, non-admin, anonymous and direct ledger access are rejected',async()=>{
      assert.equal((await call(request({owner:other}))).reason,'not_logged_in');
      await login(other);assert.equal((await call(request({owner:other}))).reason,'forbidden');
      await login('');assert.equal((await call(request())).reason,'not_logged_in');
      await db.exec('set role anon');await assert.rejects(call(request()),/permission denied/);await login(own);
      await assert.rejects(db.query('select * from private.consignment_save_requests'),/permission denied/);
    });
    await t.test('malformed payloads and extra fields cannot bypass the whitelist',async()=>{
      for(const change of [{patch:{}},{patch:{...q.patch,admin:true}},{expected:{}},{field:{}},{terms:{ind_name:'overwrite identity'}},{terms:{cmn_cancel:7}},{patch:{...q.patch,status:'unknown'}}])assert.equal((await call(request(change))).reason,'invalid_input');
      assert.equal((await call(request({patch:{...q.patch,spec:{photos:[]}}}))).reason,'photos_required');
      const rows=(await db.query("select prosecdef,proconfig from pg_proc where proname in ('save_my_consignment_bundle','save_consignment_bundle')")).rows;
      assert.equal(rows.length,2);assert.equal(rows.filter(x=>x.prosecdef).length,1);for(const x of rows)assert.ok(x.proconfig.includes('search_path=\"\"'));
    });
  }finally{await db.close();}
});
