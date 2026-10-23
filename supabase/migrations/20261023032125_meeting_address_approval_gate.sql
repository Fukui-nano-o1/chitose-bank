-- Detailed meeting addresses require approval; preserve listing visibility and historical contracts.
create schema if not exists private;
create or replace function private.can_read_meeting_address(p_job_number integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.jobs j where j.job_number=p_job_number and (
      j.farmer_id=auth.uid()
      or exists(select 1 from public.app_admins a where a.auth_id=auth.uid())
      or exists(select 1 from public.applications a where a.job_number=j.job_number
        and a.worker_id=auth.uid()
        and a.status in ('approved','meeting','interview','contracted','working','completed'))
    )
  );
$$;
revoke all on function private.can_read_meeting_address(integer) from public;
grant usage on schema private to authenticated;
grant execute on function private.can_read_meeting_address(integer) to anon,authenticated;

create or replace view public.jobs_public with (security_invoker=true) as
 SELECT j.job_number,
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
        CASE WHEN private.can_read_meeting_address(j.job_number) THEN j.address ELSE NULL::text END AS work_address,
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
                'work_address', case when private.can_read_meeting_address(j.job_number) then j.address else null::text end,
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
