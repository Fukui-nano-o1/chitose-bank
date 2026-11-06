-- MANUAL, separately authorized rollback only. Not an automatic migration.
-- Restores old behavior (including automatic approvals) for FUTURE applications.
-- Never recalculates historical statuses or backfills approvals.
begin;
lock table public.jobs, public.applications in share row exclusive mode;
do $rollback$
declare r record; g record; v_signature text;
begin
  if not exists(select 1 from retired_job_flags.runtime_archive a
    where a.helper_hash=md5(pg_get_functiondef('public.isolate_legacy_job_flags()'::regprocedure))
      and exists(select 1 from pg_trigger t where t.tgrelid='public.jobs'::regclass and t.tgname='a_isolate_legacy_job_flags'
        and t.tgenabled='O' and pg_get_triggerdef(t.oid)=a.isolation_trigger)
      and exists(select 1 from pg_trigger t where t.tgrelid='public.applications'::regclass and t.tgname='instant_approve'
        and t.tgenabled='D' and pg_get_triggerdef(t.oid)=a.legacy_trigger)) then
    raise exception 'JOB_FLAGS_ROLLBACK_DRIFT: isolation helper/trigger state changed';
  end if;
  for r in select * from retired_job_flags.function_archive loop
    if md5(pg_get_functiondef(to_regprocedure(r.signature))) is distinct from r.installed_hash
      or (select proacl from pg_proc where oid=to_regprocedure(r.signature)) is distinct from r.installed_acl then
      raise exception 'JOB_FLAGS_ROLLBACK_DRIFT: % changed after isolation',r.signature;
    end if;
  end loop;
  for r in select * from retired_job_flags.view_archive loop
    if md5(pg_get_viewdef(r.name::regclass,true)) is distinct from r.installed_hash
      or (select reloptions from pg_class where oid=r.name::regclass) is distinct from r.original_options then
      raise exception 'JOB_FLAGS_ROLLBACK_DRIFT: % changed after isolation',r.name;
    end if;
  end loop;
  for r in select * from retired_job_flags.function_archive loop
    execute r.definition;
    v_signature := r.signature;
    execute 'revoke all on function '||v_signature||' from public,anon,authenticated,service_role';
    for g in select * from aclexplode(coalesce(r.original_acl,acldefault('f','postgres'::regrole))) loop
      execute 'grant '||g.privilege_type||' on function '||v_signature||' to '||
        case when g.grantee=0 then 'public' else quote_ident(pg_get_userbyid(g.grantee)) end||
        case when g.is_grantable then ' with grant option' else '' end;
    end loop;
  end loop;
  for r in select * from retired_job_flags.view_archive loop
    execute 'create or replace view '||r.name||' with ('||array_to_string(r.original_options,',')||') as '||r.definition;
  end loop;
end $rollback$;
alter table public.jobs disable trigger a_isolate_legacy_job_flags;
alter table public.applications enable trigger instant_approve;
-- Keep archive and isolation code for inspection; nothing is dropped or erased.
commit;
