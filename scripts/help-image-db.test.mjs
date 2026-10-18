import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const own='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const url=n=>`https://project.supabase.co/storage/v1/object/public/help-images/v2/about-purpose/00000000-0000-4000-8000-00000000000${n}.jpg`;
const base=r=>r?{url:r.url,updated_at:r.updated_at}:null;
test('help references compare and save under existing public-read/admin-write RLS',async t=>{
  const db=new PGlite();
  try{
    // Production columns, PK and policy predicates read 2026-10-18. No production rows.
    await db.exec(`set timezone='UTC';create role anon;create role authenticated;create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      create table public.app_admins(auth_id uuid primary key);insert into public.app_admins values('${own}');grant select on public.app_admins to authenticated;
      create table public.help_images(slot_key text primary key,url text not null,updated_at timestamptz not null default now());
      alter table public.help_images enable row level security;
      create policy hi_read on public.help_images for select to public using(true);
      create policy hi_write on public.help_images for insert to authenticated with check(exists(select 1 from public.app_admins where auth_id=auth.uid()));
      create policy hi_update on public.help_images for update to authenticated using(exists(select 1 from public.app_admins where auth_id=auth.uid()));
      create policy hi_delete on public.help_images for delete to authenticated using(exists(select 1 from public.app_admins where auth_id=auth.uid()));
      grant select on public.help_images to anon;grant select,insert,update,delete on public.help_images to authenticated;
      create function public.qa_help_failure() returns trigger language plpgsql as $$begin
        if current_setting('qa.fail',true)='yes' then raise exception 'injected failure';end if;
        if current_setting('qa.skip',true)='yes' then return null;end if;
        if tg_op='DELETE' then return old;else return new;end if;end$$;
      create trigger qa_help_failure before insert or update or delete on public.help_images for each row execute function public.qa_help_failure();`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261018145042_help_image_compare_and_save.sql',import.meta.url),'utf8'));
    const login=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
    const read=async()=>(await db.query("select to_jsonb(h) r from public.help_images h where slot_key='about-purpose'")).rows[0]?.r||null;
    const call=async(expected,next,id=own,slot='about-purpose')=>(await db.query('select public.save_help_image_reference($1,$2,$3,$4) r',[id,slot,expected,next])).rows[0].r;
    await login(own);let first,second;
    await t.test('create and replacement return confirmed records',async()=>{first=await call(null,url(1));assert.equal(first.ok,true);second=await call(base(first.row),url(2));assert.equal(second.ok,true);assert.equal((await read()).url,url(2));});
    await t.test('old update and old deletion both reject newer references',async()=>{assert.equal((await call(base(first.row),url(3))).reason,'conflict');assert.equal((await call(base(first.row),null)).reason,'conflict');assert.equal((await read()).url,url(2));});
    await t.test('same target replay is harmless',async()=>{assert.equal((await call(base(first.row),url(2))).ok,true);assert.deepEqual(await read(),second.row);});
    await t.test('DB refusal leaves the original reference',async()=>{await db.query("select set_config('qa.fail','yes',false)");await assert.rejects(call(base(second.row),null),/injected failure/);assert.deepEqual(await read(),second.row);await db.query("select set_config('qa.fail','no',false)");});
    await t.test('zero affected rows are not deletion or replacement success',async()=>{await db.query("select set_config('qa.skip','yes',false)");await assert.rejects(call(base(second.row),null),/DELETE_NOT_CONFIRMED/);await assert.rejects(call(base(second.row),url(3)),/SAVE_NOT_CONFIRMED/);assert.deepEqual(await read(),second.row);await db.query("select set_config('qa.skip','no',false)");});
    await t.test('delete only changes the reference and replay succeeds with no row',async()=>{const r=await call(base(second.row),null);assert.equal(r.ok,true);assert.equal(r.row,null);assert.equal(await read(),null);assert.equal((await call(base(second.row),null)).ok,true);});
    await t.test('non-admin, wrong account and anonymous cannot change references',async()=>{assert.equal((await call(null,url(1),other)).reason,'not_logged_in');await login(other);assert.equal((await call(null,url(1),other)).reason,'forbidden');await login('');assert.equal((await call(null,url(1))).reason,'not_logged_in');await db.exec('set role anon');await assert.rejects(call(null,url(1)),/permission denied/);await login(own);});
    await t.test('invalid shapes and URLs fail before writes; function remains invoker',async()=>{
      assert.equal((await call({},url(1))).reason,'invalid_input');for(const target of ['javascript:bad','https://x/old.jpg'])assert.equal((await call(null,target)).reason,'invalid_input');assert.equal((await call(null,url(1),own,'../other')).reason,'invalid_input');
      const f=(await db.query("select prosecdef,proconfig from pg_proc where proname='save_help_image_reference'")).rows[0];assert.equal(f.prosecdef,false);assert.ok(f.proconfig.includes('search_path=\"\"'));
    });
  }finally{await db.close();}
});
