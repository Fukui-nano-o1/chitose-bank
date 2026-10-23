create role anon;create role authenticated;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon')$$;
grant usage on schema auth to anon,authenticated;
create table public.jobs(id uuid,farmer_id uuid,created_at timestamptz,status text,crop text,task text,zip text,prefecture text,city text,address text,date_label text,headcount int4,pay_type text,hourly_wage text,daily_wage text,work_time text,break_time text,nearest_station text,commute_time text,job_exp text,notes text,danger_places jsonb,danger_tasks jsonb,photos jsonb,belongings text,cautions text,job_number int4 primary key,date_start date,date_end date,draft_step int4,town text,lat numeric,lng numeric,geocoded_from text,geo_radius_m int4,full_pay_guarantee bool,beginner_ok bool,instant_approve_repeat bool,opened_at timestamptz,perks jsonb,experienced_preferred bool,revision_requested_at timestamptz,recruiter_name text,recruiter_address text,recruiter_contact text,insurance_snapshot jsonb,profile_snapshot_at timestamptz,pay_method text,pay_timing text,wage_closing_rule text,holidays jsonb,recruiter_name_kana text,overtime_policy text,overtime_detail text,unlisted_at timestamptz,unlisted_reason text,place_change_scope text,task_change_scope text,contract_renewal text,retirement_terms text,labor_insurance_status text,work_video_url text,work_video_job_consent bool,work_video_related_consent bool,work_video_consent_at timestamptz,work_video_consent_version text,draft_step_id text);
create table public.applications(id uuid default gen_random_uuid(),job_number int,worker_id uuid,farmer_id uuid,status text,terms_confirmed_worker_at timestamptz,terms_confirmed_farmer_at timestamptz,terms_snapshot jsonb);
create table public.employer_profiles(auth_id uuid primary key,nickname text,avatar_url text);
create table public.app_admins(auth_id uuid primary key);
create function public.is_account_moderated(id uuid) returns boolean language sql stable as $$select false$$;
create function public.is_job_party(n int) returns boolean language sql stable security definer as $$select auth.uid() is not null and (exists(select 1 from public.jobs where job_number=n and farmer_id=auth.uid()) or exists(select 1 from public.applications where job_number=n and worker_id=auth.uid()) or exists(select 1 from public.app_admins where auth_id=auth.uid()))$$;
alter table public.jobs enable row level security;
grant select on public.jobs,public.applications,public.employer_profiles to anon,authenticated;
create policy owner on public.jobs for select to authenticated using(farmer_id=auth.uid());
create view public.jobs_public with (security_invoker=true) as  SELECT j.job_number,
    j.crop,
    j.task,
    j.prefecture,
    j.city,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.town
        END AS town,
    j.date_label,
    j.date_start,
    j.date_end,
    j.headcount,
    j.pay_type,
    j.hourly_wage,
    j.daily_wage,
    j.work_time,
    j.break_time,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.nearest_station
        END AS nearest_station,
    j.commute_time,
    j.job_exp,
    j.notes,
    j.belongings,
    j.cautions,
    j.danger_places,
    j.danger_tasks,
    j.photos,
    j.created_at,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN round(j.lat, 2)
            ELSE j.lat
        END AS lat,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN round(j.lng, 2)
            ELSE j.lng
        END AS lng,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN
            CASE
                WHEN j.lat IS NULL THEN NULL::integer
                ELSE GREATEST(COALESCE(j.geo_radius_m, 500), 3000)
            END
            ELSE j.geo_radius_m
        END AS geo_radius_m,
    j.full_pay_guarantee,
    j.beginner_ok,
    j.instant_approve_repeat,
    j.opened_at,
    j.perks,
    j.experienced_preferred,
    ( SELECT count(*) AS count
           FROM applications a
          WHERE a.job_number = j.job_number AND a.terms_confirmed_worker_at IS NOT NULL AND a.terms_confirmed_farmer_at IS NOT NULL) AS hired_count,
    ep.nickname AS employer_nickname,
    ep.avatar_url AS employer_avatar_url,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.recruiter_name
        END AS recruiter_name,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.recruiter_address
        END AS recruiter_address,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.recruiter_contact
        END AS recruiter_contact,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.address
        END AS work_address,
    j.insurance_snapshot,
    j.profile_snapshot_at,
    j.pay_method,
    j.pay_timing,
    j.wage_closing_rule,
    j.holidays,
    j.address IS NOT NULL AND btrim(j.address) <> ''::text AS has_work_address,
    j.overtime_policy,
    j.overtime_detail,
    j.status,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN array_remove(ARRAY[
            CASE
                WHEN j.town IS NOT NULL AND btrim(j.town) <> ''::text THEN 'town'::text
                ELSE NULL::text
            END,
            CASE
                WHEN j.nearest_station IS NOT NULL AND btrim(j.nearest_station) <> ''::text THEN 'nearest_station'::text
                ELSE NULL::text
            END,
            CASE
                WHEN j.recruiter_name IS NOT NULL AND btrim(j.recruiter_name) <> ''::text THEN 'recruiter_name'::text
                ELSE NULL::text
            END,
            CASE
                WHEN j.recruiter_address IS NOT NULL AND btrim(j.recruiter_address) <> ''::text THEN 'recruiter_address'::text
                ELSE NULL::text
            END,
            CASE
                WHEN j.recruiter_contact IS NOT NULL AND btrim(j.recruiter_contact) <> ''::text THEN 'recruiter_contact'::text
                ELSE NULL::text
            END], NULL::text)
            ELSE ARRAY[]::text[]
        END AS masked_fields,
    j.place_change_scope,
    j.task_change_scope,
    j.contract_renewal,
    j.retirement_terms,
    j.labor_insurance_status,
        CASE
            WHEN j.work_video_job_consent IS TRUE THEN j.work_video_url
            ELSE NULL::text
        END AS work_video_url
   FROM jobs j
     LEFT JOIN employer_profiles ep ON ep.auth_id = j.farmer_id
  WHERE (j.status = 'open'::text OR j.status = 'closed'::text AND j.headcount IS NOT NULL AND j.headcount > 0 AND (( SELECT count(*) AS count
           FROM applications a
          WHERE a.job_number = j.job_number AND a.terms_confirmed_worker_at IS NOT NULL AND a.terms_confirmed_farmer_at IS NOT NULL)) >= j.headcount) AND j.unlisted_reason IS NULL AND NOT is_account_moderated(j.farmer_id);
grant select on public.jobs_public to anon,authenticated;
CREATE OR REPLACE FUNCTION public.job_details_for_party(p_job_numbers integer[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- same shape as a logged-in jobs_public row, built with to_jsonb(j) so new jobs
  -- columns follow automatically. Only the 5 derived fields are spelled out.
  select coalesce(jsonb_agg(x.row_json), '[]'::jsonb)
  from (
    select (to_jsonb(j)
             - 'id' - 'farmer_id' - 'address' - 'zip' - 'draft_step'
             - 'geocoded_from' - 'unlisted_at' - 'unlisted_reason' - 'revision_requested_at')
           || jsonb_build_object(
                'work_address', j.address,
                'has_work_address', (j.address is not null and btrim(j.address) <> ''),
                'employer_nickname', ep.nickname,
                'employer_avatar_url', ep.avatar_url,
                'hired_count', (select count(*) from public.applications a
                                 where a.job_number = j.job_number
                                   and a.terms_confirmed_worker_at is not null
                                   and a.terms_confirmed_farmer_at is not null),
                'masked_fields', '[]'::jsonb) as row_json
      from public.jobs j
      left join public.employer_profiles ep on ep.auth_id = j.farmer_id
     where j.job_number = any (p_job_numbers[1:100])
       and auth.uid() is not null and public.is_job_party(j.job_number)
  ) x;
$function$;

revoke all on function public.job_details_for_party(integer[]) from public,anon;grant execute on function public.job_details_for_party(integer[]) to authenticated;
CREATE OR REPLACE FUNCTION public.job_meeting_place(p_job_number integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_address text; v_town text; v_city text; v_pref text;
begin
  -- 資格：その求人に approved 以降の応募を持つ働き手、または求人の農家本人
  if not exists (
    select 1 from public.applications a
     where a.job_number = p_job_number
       and (a.worker_id = auth.uid() and a.status in ('approved','meeting','interview','contracted','working','completed'))
  ) and not exists (
    select 1 from public.jobs j
     where j.job_number = p_job_number and j.farmer_id = auth.uid()
  ) then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;

  select prefecture, city, town, address into v_pref, v_city, v_town, v_address
    from public.jobs where job_number = p_job_number;

  return json_build_object('ok', true,
    'full_address', coalesce(v_pref,'') || coalesce(v_city,'') || coalesce(v_town,'') || ' ' || coalesce(v_address,''));
end;
$function$;
