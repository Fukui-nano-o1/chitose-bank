-- Synthetic shape only; no production rows. Baseline function bodies captured
-- is_job_party follows the existing 20260824020500 migration.
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table auth.users(id uuid primary key,created_at timestamptz);
create table public.account_holders(auth_id uuid primary key,entity_type text);
create table public.app_admins(auth_id uuid primary key);
create table public.jobs(job_number integer primary key,farmer_id uuid,status text,date_start date,date_end date);
create table public.applications(id bigint primary key,job_number integer,farmer_id uuid,worker_id uuid,status text,attended boolean,terms_confirmed_worker_at timestamptz,terms_confirmed_farmer_at timestamptz,decided_at timestamptz,created_at timestamptz);
create table public.reviews(application_id bigint,reviewee_id uuid,direction text,match_level text,want_again boolean);
create table public.account_moderation(auth_id uuid primary key,state text);
-- This stub isolates the unchanged aggregate/publication calculation.
create function public.app_review_published(bigint) returns boolean language sql as $$select true$$;
CREATE OR REPLACE FUNCTION public.is_account_moderated(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.account_moderation m
                  where m.auth_id = p_uid and m.state in ('suspended','banned'));
$function$;
CREATE OR REPLACE FUNCTION public.is_job_party(p_job_number integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- party = the job's own farmer / a worker who applied to it (any status) / an admin
  select auth.uid() is not null and (
    exists (select 1 from public.jobs j
             where j.job_number = p_job_number and j.farmer_id = auth.uid())
    or exists (select 1 from public.applications a
                where a.job_number = p_job_number and a.worker_id = auth.uid())
    or exists (select 1 from public.app_admins ad where ad.auth_id = auth.uid())
  );
$function$;
CREATE OR REPLACE FUNCTION public.employer_trust_info(p_farmer_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ok boolean;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_matched int; v_partly int; v_differed int;
begin
  -- 停止・追放中の農家の信頼情報は本人以外に返さない（2026-08-16）
  if public.is_account_moderated(p_farmer_id)
     and (auth.uid() is null or auth.uid() <> p_farmer_id) then
    return json_build_object('ok', false);
  end if;
  v_ok := auth.uid() = p_farmer_id
    or exists (select 1 from public.applications a
                where a.farmer_id = p_farmer_id and a.worker_id = auth.uid())
    or exists (select 1 from public.jobs j
                where j.farmer_id = p_farmer_id and j.status = 'open');  -- 公開求人の農家は誰でも閲覧可
  if not v_ok then return json_build_object('ok', false); end if;

  -- 求人内容との一致（1契約1票・publishedのみ＝双方揃うか完了3日・第8条3）
  select count(*) filter (where r.match_level = 'matched'),
         count(*) filter (where r.match_level = 'partly'),
         count(*) filter (where r.match_level = 'differed')
    into v_matched, v_partly, v_differed
    from public.reviews r
    join public.applications a on a.id = r.application_id
   where r.reviewee_id = p_farmer_id
     and r.direction = 'worker_to_farmer'
     and r.match_level is not null
     and public.app_review_published(r.application_id);

  return (select json_build_object('ok', true,
    'member_since', to_char(u.created_at at time zone 'Asia/Tokyo','YYYY年MM月'),
    'id_checked', exists(select 1 from public.account_holders ah where ah.auth_id = p_farmer_id),
    'entity_type', (select ah.entity_type from public.account_holders ah where ah.auth_id = p_farmer_id),
    'completed_hires', (select count(*) from public.applications a
                          join public.jobs j on j.job_number = a.job_number
                         where a.farmer_id = p_farmer_id and a.status = 'completed'
                           and a.attended is true
                           and not (j.status = 'open'
                                    and (coalesce(j.date_end, j.date_start) is null
                                         or coalesce(j.date_end, j.date_start) >= v_today))),
    'open_jobs', (select count(*) from public.jobs j
                   where j.farmer_id = p_farmer_id and j.status = 'open'
                     and (coalesce(j.date_end, j.date_start) is null
                          or coalesce(j.date_end, j.date_start) >= v_today)),
    'ended_jobs', (select count(*) from public.jobs j
                    where j.farmer_id = p_farmer_id
                      and (j.status = 'closed'
                           or (j.status = 'open'
                               and coalesce(j.date_end, j.date_start) < v_today))),
    'active_applied', (select count(*) from public.applications a
                         join public.jobs j on j.job_number = a.job_number
                        where a.farmer_id = p_farmer_id
                          and a.status in ('applied','approved','working','completed')
                          and j.status = 'open'
                          and (coalesce(j.date_end, j.date_start) is null
                               or coalesce(j.date_end, j.date_start) >= v_today)),
    'active_approved', (select count(*) from public.applications a
                          join public.jobs j on j.job_number = a.job_number
                         where a.farmer_id = p_farmer_id
                           and a.status in ('approved','working','completed')
                           and j.status = 'open'
                           and (coalesce(j.date_end, j.date_start) is null
                                or coalesce(j.date_end, j.date_start) >= v_today)),
    'active_hired', (select count(*) from public.applications a
                       join public.jobs j on j.job_number = a.job_number
                      where a.farmer_id = p_farmer_id
                        and a.terms_confirmed_worker_at is not null
                        and a.terms_confirmed_farmer_at is not null
                        and j.status = 'open'
                        and (coalesce(j.date_end, j.date_start) is null
                             or coalesce(j.date_end, j.date_start) >= v_today)),
    'want_again_workers', (select count(*) from public.reviews r
                            where r.reviewee_id = p_farmer_id
                              and r.direction = 'worker_to_farmer' and r.want_again = true
                              and public.app_review_published(r.application_id)),
    'match_total', (v_matched + v_partly + v_differed),
    'match_matched', v_matched,
    'match_partly', v_partly,
    'match_differed', v_differed,
    'avg_response_hours', (select round(avg(extract(epoch from (decided_at - created_at))/3600)::numeric, 1)
                            from public.applications a
                           where a.farmer_id = p_farmer_id and a.decided_at is not null),
    'avg_approval_hours', (select round(avg(extract(epoch from (decided_at - created_at))/3600)::numeric, 1)
                            from public.applications a
                           where a.farmer_id = p_farmer_id and a.decided_at is not null and a.status <> 'rejected'))
    from auth.users u where u.id = p_farmer_id);
end; $function$;
CREATE OR REPLACE FUNCTION public.job_exists(p_job_number integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.jobs where job_number = p_job_number);
$function$;
revoke all on function public.is_job_party(integer) from public,anon,authenticated;
grant execute on function public.employer_trust_info(uuid),public.job_exists(integer),public.is_account_moderated(uuid) to anon,authenticated,service_role;
alter table jobs enable row level security;
alter table applications enable row level security;
grant select on jobs,applications to anon,authenticated;
create policy own_job on jobs for select using(farmer_id=auth.uid());
create policy own_application on applications for select using(worker_id=auth.uid() or farmer_id=auth.uid());
