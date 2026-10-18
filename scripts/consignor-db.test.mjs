import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const own='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
test('consignor phone and profile share a transaction under existing admin and owner RLS',async t=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      create table public.app_admins(auth_id uuid primary key);insert into public.app_admins values('${own}');grant select on public.app_admins to authenticated;
      create table public.account_holders(auth_id uuid primary key,full_name text,postal_code text,address text,contact_email text,contact_phone text,company_name text,birth_date date);
      insert into public.account_holders(auth_id) values('${own}'),('${other}');
      alter table public.account_holders enable row level security;
      create policy own_read on public.account_holders for select to authenticated using(auth_id=auth.uid());
      create policy own_update on public.account_holders for update to authenticated using(auth_id=auth.uid()) with check(auth_id=auth.uid());
      grant select,update on public.account_holders to authenticated;
      create table public.qa_phone_history(phone text,source text);
      create function public.qa_phone_write() returns trigger language plpgsql security definer as $$begin
        if current_setting('qa.fail_phone',true)='yes' then raise exception 'phone failure';end if;
        insert into public.qa_phone_history values(new.contact_phone,current_setting('app.change_source',true));return new;end$$;
      create trigger qa_phone_write after update on public.account_holders for each row execute function public.qa_phone_write();
    `);
    for(const file of ['./fixtures/consignor-prod-schema.sql','./fixtures/account-holder-update-prod.sql','../supabase/migrations/20261018142801_consignor_atomic_profile_save.sql'])await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
    await db.exec(`alter table public.consignment_profiles enable row level security;
      create policy admin_all on public.consignment_profiles for all to authenticated using(exists(select 1 from public.app_admins where auth_id=auth.uid())) with check(exists(select 1 from public.app_admins where auth_id=auth.uid()));
      grant select,insert,update on public.consignment_profiles to authenticated;
      create function public.qa_profile_write() returns trigger language plpgsql as $$begin
        if current_setting('qa.fail_profile',true)='yes' then raise exception 'profile failure';end if;return new;end$$;
      create trigger qa_profile_write before insert or update on public.consignment_profiles for each row execute function public.qa_profile_write();
    `);
    const login=async uid=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');};
    const admin=async(sql,args=[])=>{await db.exec('reset role');try{return await db.query(sql,args);}finally{await login(own);}};
    const read=async()=>(await db.query('select consignor_type,consignor_data from public.consignment_profiles where auth_id=$1',[own])).rows[0]||null;
    const call=async(expected,data,phone='08000000000',expectedPhone=null,type='individual',id=own)=>(await db.query('select public.save_my_consignor_profile($1,$2,$3,$4,$5,$6) r',[id,expected,type,data,expectedPhone,phone])).rows[0].r;
    const count=async()=>(await admin('select count(*)::int n from public.qa_phone_history')).rows[0].n;
    const setting=async(key,value)=>db.query('select set_config($1,$2,false)',['qa.fail_'+key,value]);
    await login(own);
    await t.test('phone refusal leaves the profile and phone unchanged',async()=>{
      await setting('phone','yes');await assert.rejects(call(null,{cmn_bank:'bank'}),/phone failure/);
      assert.equal(await read(),null);assert.equal(await count(),0);
      assert.equal((await db.query('select contact_phone from public.account_holders where auth_id=$1',[own])).rows[0].contact_phone,null);
      await setting('phone','no');
    });
    await t.test('profile refusal rolls back the canonical phone and its history',async()=>{
      await setting('profile','yes');await assert.rejects(call(null,{cmn_bank:'bank'}),/profile failure/);
      assert.equal(await read(),null);assert.equal(await count(),0);
      assert.equal((await db.query('select contact_phone from public.account_holders where auth_id=$1',[own])).rows[0].contact_phone,null);
      await setting('profile','no');
    });
    await t.test('success confirms both records and replays without a second phone history',async()=>{
      const data={cmn_bank:'bank',ind_phone:'08000000000',ind_name:'must not be duplicated'};
      const r=await call(null,data);assert.equal(r.ok,true);assert.equal(r.account.contact_phone,'08000000000');
      assert.deepEqual(r.profile.consignor_data,{cmn_bank:'bank'});assert.equal(await count(),1);
      assert.equal((await call(null,data)).ok,true);assert.equal(await count(),1);
      assert.equal((await admin('select source from public.qa_phone_history')).rows[0].source,'consignment_flow');
    });
    await t.test('stale full JSON cannot overwrite another editor; unrelated columns survive',async()=>{
      const old=await read();await admin("update public.consignment_profiles set consignor_data=consignor_data||'{\"cmn_lend_items\":[\"new tool\"]}',nickname='keep nickname' where auth_id=$1",[own]);
      assert.equal((await call(old,{cmn_bank:'old form'},null)).reason,'conflict');
      const fresh=await read();assert.equal((await call(fresh,{...fresh.consignor_data,cmn_bank:'new bank'},null)).ok,true);
      assert.equal((await db.query('select nickname from public.consignment_profiles where auth_id=$1',[own])).rows[0].nickname,'keep nickname');
    });
    await t.test('a different canonical phone is never overwritten from the flow',async()=>{
      const old=await read();assert.equal((await call(old,{cmn_bank:'attempt'},'09000000000')).reason,'phone_conflict');
      assert.deepEqual(await read(),old);
    });
    await t.test('existing RLS rejects non-admin profile writes and rolls back their phone',async()=>{
      await login(other);assert.equal((await call(null,{cmn_bank:'old session'})).reason,'not_logged_in');
      await assert.rejects(call(null,{cmn_bank:'denied'},'08000000000',null,'individual',other),/row-level security/);
      assert.equal((await db.query('select contact_phone from public.account_holders where auth_id=$1',[other])).rows[0].contact_phone,null);
      await login('');assert.equal((await call(null,{})).reason,'not_logged_in');
      await db.exec('set role anon');await assert.rejects(call(null,{}),/permission denied/);await login(own);
    });
    await t.test('invalid type and malformed baseline cannot bypass the compare',async()=>{
      for(const type of ['',null,'other'])assert.equal((await call(await read(),{},null,null,type)).reason,'invalid_input');
      assert.equal((await call({},{})).reason,'invalid_input');
      assert.equal((await call({...await read(),extra:true},{})).reason,'invalid_input');
    });
    await t.test('consent changes only its fields and enforces the original account at the server',async()=>{
      const before=await read();
      const consent=async id=>(await db.query("select public.save_my_consignor_consent($1,'current','2026-10-18T00:00:00Z') r",[id])).rows[0].r;
      assert.equal((await consent(other)).reason,'not_logged_in');
      assert.equal((await consent(own)).ok,true);assert.deepEqual(await read(),before);
      await setting('profile','yes');await assert.rejects(consent(own),/profile failure/);await setting('profile','no');
      await db.exec('set role anon');await assert.rejects(consent(own),/permission denied/);await login(own);
      const functions=(await db.query("select prosecdef,proconfig from pg_proc where proname in ('save_my_consignor_profile','save_my_consignor_consent')")).rows;
      assert.equal(functions.length,2);for(const f of functions){assert.equal(f.prosecdef,false);assert.ok(f.proconfig.includes('search_path=\"\"'));}
    });
  }finally{await db.close();}
});
