-- Read-only audit queries. No user input bodies, credentials, mutations or RPC execution.
-- Run each SELECT separately if the SQL client only returns the final result set.
select now() as checked_at;

select version from supabase_migrations.schema_migrations order by version desc limit 5;

select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anonymous_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname in (
  'publish_my_job_with_check','publish_my_job','sync_my_job_draft','sync_my_open_job',
  'copy_job','ask_job_question','answer_job_question','confirm_insurance','update_account_holder_self'
);

select p.proname, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'copy_job','ask_job_question','answer_job_question','confirm_insurance','set_my_available_dates'
);

select column_name,column_default,is_nullable
from information_schema.columns
where table_schema='public' and table_name='jobs' and column_name in ('full_pay_guarantee','work_time');

select count(*) as public_tables, count(*) filter(where not rowsecurity) as rls_disabled
from pg_tables where schemaname='public';

select tablename,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('employer_profiles','worker_profiles','emergency_contacts');

select tgrelid::regclass as relation,pg_get_triggerdef(oid) as definition from pg_trigger
where tgrelid in ('public.employer_profiles'::regclass,'public.worker_profiles'::regclass,'public.attendance_events'::regclass)
  and not tgisinternal;

select indexdef from pg_indexes where schemaname='public' and tablename='attendance_events';

select t.relname,pg_get_constraintdef(c.oid) as definition
from pg_constraint c join pg_class t on t.oid=c.conrelid
where c.conrelid in ('public.account_holders'::regclass,'public.reviews'::regclass,'public.saved_jobs'::regclass)
  and c.contype in ('p','u');

select count(*) filter(where j.status='open') as open_jobs,
       count(*) filter(where j.status='open' and not exists(
         select 1 from public.job_publish_checks c where c.job_number=j.job_number
       )) as open_jobs_without_any_check,
       count(*) filter(where j.status='open' and j.full_pay_guarantee) as open_jobs_with_full_pay_guarantee
from public.jobs j;

-- Exact path lookup only. Does not fetch image contents or prove historical consistency.
with refs as (
  select 'employer_profiles' as source,avatar_url from public.employer_profiles
  union all select 'worker_profiles',avatar_url from public.worker_profiles
), local_refs as (
  select source,split_part(split_part(avatar_url,'/storage/v1/object/public/avatars/',2),'?',1) as object_name
  from refs where avatar_url like '%/storage/v1/object/public/avatars/%'
)
select source,count(*) as stored_avatar_references,count(*) filter(where not exists(
  select 1 from storage.objects o where o.bucket_id='avatars' and o.name=local_refs.object_name
)) as references_without_matching_storage_object
from local_refs group by source;
