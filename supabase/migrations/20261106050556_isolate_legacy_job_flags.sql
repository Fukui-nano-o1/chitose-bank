-- Retire two optional job flags without deleting historical data or implementation.
-- Apply this one migration atomically. No replay of historical migrations.
begin;
lock table public.jobs, public.applications in share row exclusive mode;
do $preflight$
declare item record; v_pending bigint;
begin
  if to_regnamespace('retired_job_flags') is not null then
    raise exception 'JOB_FLAGS_PREFLIGHT_DRIFT: archive already exists';
  end if;
  for item in select * from (values
    ('public.job_details_for_party(integer[])', '5f4d3c0163772bfe74a90b9d52b754c8'),
    ('public.my_farm_jobs()', 'bd73d036504f4f4f9c1b4876d88b673b'),
    ('public.trg_instant_approve()', '9a4886e14cfc9d1748073c1c7dbc1d51'),
    ('public.trg_notify_roster()', 'aa3cc9b616a7a07604dc786310f7bb07'),
    ('public.trg_notify_application()', '1e7794fda0b3d41b8a7effa0b92f93b4'),
    ('public.apply_to_job(integer,jsonb)', '02d2f7505f39bc5875085adbd7054c6e')
  ) v(signature, expected_hash) loop
    if not exists (select 1 from pg_proc p
      where p.oid=to_regprocedure(item.signature) and p.proowner='postgres'::regrole
      and md5(pg_get_functiondef(p.oid))=item.expected_hash) then
      raise exception 'JOB_FLAGS_PREFLIGHT_DRIFT: % definition/owner changed', item.signature;
    end if;
  end loop;
  if exists(select 1 from pg_proc p where p.oid in ('public.apply_to_job(integer,jsonb)'::regprocedure,'public.my_farm_jobs()'::regprocedure,'public.job_details_for_party(integer[])'::regprocedure)
    and p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}') then
    raise exception 'JOB_FLAGS_PREFLIGHT_DRIFT: application/card RPC privileges changed';
  end if;
  if (select reloptions from pg_class where oid='public.jobs_public'::regclass)
    is distinct from array['security_invoker=false','security_barrier=true']::text[] then
    raise exception 'JOB_FLAGS_PREFLIGHT_DRIFT: public view security options changed';
  end if;
  -- Never delete queued messages. If an old message is still queued, stop and
  -- let the operator inspect/deliver it before the coordinated release.
  if to_regclass('net.http_request_queue') is not null then
    execute $queue$select count(*) from net.http_request_queue
      where convert_from(body,'UTF8') like '%リピート即決%'
        or convert_from(body,'UTF8') like '%即決で承認%'
        or convert_from(body,'UTF8') like '%選考なしで即決%'$queue$ into v_pending;
    if v_pending>0 then raise exception 'JOB_FLAGS_PENDING_LEGACY_MAIL: % queued messages require review',v_pending;end if;
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.applications'::regclass
      and tgname='instant_approve' and tgfoid='public.trg_instant_approve()'::regprocedure and tgenabled='O')
    or (select count(*) from pg_trigger where tgfoid='public.trg_instant_approve()'::regprocedure) <> 1 then
    raise exception 'JOB_FLAGS_PREFLIGHT_DRIFT: instant approval trigger changed';
  end if;
  -- The ordinary API must still enforce identity; never compensate by opening RLS.
  if not (select relrowsecurity from pg_class where oid='public.applications'::regclass)
    or exists(select 1 from pg_policy where polrelid='public.applications'::regclass and polcmd <> 'r') then
    raise exception 'JOB_FLAGS_PREFLIGHT_DRIFT: applications write policies require review';
  end if;
end $preflight$;

-- Inert SQL text, NOT callable historical SECURITY DEFINER functions.
create schema retired_job_flags authorization postgres;
revoke all on schema retired_job_flags from public,anon,authenticated,service_role;
create table retired_job_flags.function_archive (
  signature text primary key, definition text not null, original_acl aclitem[],
  installed_hash text, installed_acl aclitem[], archived_at timestamptz not null default now()
);
alter table retired_job_flags.function_archive enable row level security;
revoke all on retired_job_flags.function_archive from public,anon,authenticated,service_role;
insert into retired_job_flags.function_archive(signature,definition,original_acl)
select p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proacl from pg_proc p
where p.oid in ('public.job_details_for_party(integer[])'::regprocedure,'public.my_farm_jobs()'::regprocedure,'public.trg_instant_approve()'::regprocedure,'public.trg_notify_roster()'::regprocedure,
  'public.trg_notify_application()'::regprocedure,'public.apply_to_job(integer,jsonb)'::regprocedure);

create table retired_job_flags.view_archive (
  name text primary key, definition text not null, original_options text[], installed_hash text
);
alter table retired_job_flags.view_archive enable row level security;
revoke all on retired_job_flags.view_archive from public,anon,authenticated,service_role;
insert into retired_job_flags.view_archive(name,definition,original_options)
select 'public.jobs_public',pg_get_viewdef(c.oid,true),c.reloptions
from pg_class c where c.oid='public.jobs_public'::regclass;

-- Double barrier: no trigger invocation, and no executable old approval body.
alter table public.applications disable trigger instant_approve;
create or replace function public.trg_instant_approve()
returns trigger language plpgsql security invoker set search_path='' as $function$
begin
  return new;
end $function$;
revoke all on function public.trg_instant_approve() from public,anon,authenticated,service_role;

-- Freeze retained values on existing records. New records/copies cannot opt in,
-- even through old clients or SECURITY DEFINER writers. Existing rows are untouched.
create function public.isolate_legacy_job_flags()
returns trigger language plpgsql security invoker set search_path='' as $function$
begin
  if tg_op='INSERT' then
    new.beginner_ok := false;
    new.instant_approve_repeat := false;
  else
    new.beginner_ok := old.beginner_ok;
    new.instant_approve_repeat := old.instant_approve_repeat;
  end if;
  return new;
end $function$;
revoke all on function public.isolate_legacy_job_flags() from public,anon,authenticated,service_role;
create trigger a_isolate_legacy_job_flags before insert or update on public.jobs
for each row execute function public.isolate_legacy_job_flags();

-- Change only repeat-specific branches; retain all normal application gates,
-- roster membership, opt-out checks, normal notifications and manual approval.
do $isolate$
declare v_definition text; v_old text; v_new text;
begin
  v_definition := pg_get_functiondef('public.trg_notify_roster()'::regprocedure);
  v_old := $retired$  v_instant := case when coalesce(new.instant_approve_repeat, false)
    then E'\nこの求人は、応募すると選考なしで即決になります。' else '' end;$retired$;
  v_new := $active$  v_instant := ''; -- Retired feature: keep ordinary roster notifications.$active$;
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'JOB_FLAGS_PREFLIGHT_DRIFT: public.trg_notify_roster() branch changed';
  end if;
  execute replace(v_definition,v_old,v_new);
  v_definition := pg_get_functiondef('public.trg_notify_application()'::regprocedure);
  v_old := $retired$    v_wnote := case when v_now_status = 'approved'
      then 'リピート即決の設定により、応募は自動で承認されました（まだ採用ではありません）。チャットで打ち合わせに進めます。'
      else 'まだ採用ではありません。農家が内容を確認し、承認するとお知らせが届きます（作業日の前日までに、必ず結果が届きます）。' end;$retired$;
  v_new := $active$    v_wnote := 'まだ採用ではありません。農家が内容を確認し、承認するとお知らせが届きます（作業日の前日までに、必ず結果が届きます）。';$active$;
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'JOB_FLAGS_PREFLIGHT_DRIFT: public.trg_notify_application() branch changed';
  end if;
  execute replace(v_definition,v_old,v_new);
  v_definition := pg_get_functiondef('public.apply_to_job(integer,jsonb)'::regprocedure);
  v_old := $retired$    if exists (select 1 from public.applications a where a.id = v_app_id and a.status = 'approved') then
      insert into public.messages (application_id, sender_id, body)
      values (v_app_id, v_farmer_id, '🌟リピート即決の設定により、応募を自動で承認しました（採用ではありません）。チャットで打ち合わせを進めましょう。');
    end if;$retired$;
  v_new := $active$    -- Retired repeat approval: only the worker's normal application message is created.$active$;
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'JOB_FLAGS_PREFLIGHT_DRIFT: public.apply_to_job(integer,jsonb) branch changed';
  end if;
  execute replace(v_definition,v_old,v_new);
  v_definition := pg_get_functiondef('public.my_farm_jobs()'::regprocedure);
  v_old := 'headcount, beginner_ok, experienced_preferred, instant_approve_repeat,';
  v_new := 'headcount, false as beginner_ok, experienced_preferred, false as instant_approve_repeat,';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'JOB_FLAGS_PREFLIGHT_DRIFT: my_farm_jobs fields changed';
  end if;
  execute replace(v_definition,v_old,v_new);

  v_definition := pg_get_functiondef('public.job_details_for_party(integer[])'::regprocedure);
  v_old := '|| jsonb_build_object(';
  v_new := '|| jsonb_build_object(''beginner_ok'', false, ''instant_approve_repeat'', false,';
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
    raise exception 'JOB_FLAGS_PREFLIGHT_DRIFT: party presentation changed';
  end if;
  execute replace(v_definition,v_old,v_new);

  -- Public presentation only. Owner edit/sync reads from jobs retain original bits.
  -- CREATE OR REPLACE retains identity/grants/dependencies. Reapply options explicitly.
  v_definition := pg_get_viewdef('public.jobs_public'::regclass,true);
  foreach v_old in array array['j.beginner_ok,','j.instant_approve_repeat,'] loop
    if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old) <> 1 then
      raise exception 'JOB_FLAGS_PREFLIGHT_DRIFT: public view flag changed';
    end if;
    v_new := case when v_old='j.beginner_ok,' then 'false AS beginner_ok,' else 'false AS instant_approve_repeat,' end;
    v_definition := replace(v_definition,v_old,v_new);
  end loop;
  execute 'create or replace view public.jobs_public with (' ||
    (select array_to_string(original_options,',') from retired_job_flags.view_archive where name='public.jobs_public') || ') as ' || v_definition;
end $isolate$;
revoke all on function public.trg_notify_roster(),public.trg_notify_application()
  from public,anon,authenticated,service_role;
update retired_job_flags.function_archive a set installed_hash=md5(pg_get_functiondef(to_regprocedure(a.signature))),
  installed_acl=(select proacl from pg_proc where oid=to_regprocedure(a.signature));
update retired_job_flags.view_archive a set installed_hash=md5(pg_get_viewdef(a.name::regclass,true));
create table retired_job_flags.runtime_archive (
  helper_hash text not null,
  isolation_trigger text not null,
  legacy_trigger text not null
);
alter table retired_job_flags.runtime_archive enable row level security;
revoke all on retired_job_flags.runtime_archive from public,anon,authenticated,service_role;
insert into retired_job_flags.runtime_archive
select md5(pg_get_functiondef('public.isolate_legacy_job_flags()'::regprocedure)),
  (select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.jobs'::regclass and tgname='a_isolate_legacy_job_flags'),
  (select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.applications'::regclass and tgname='instant_approve');
comment on schema retired_job_flags is 'Retired job flags: inert implementation archive. No user-facing access; rollback requires an explicit reviewed release.';
commit;

