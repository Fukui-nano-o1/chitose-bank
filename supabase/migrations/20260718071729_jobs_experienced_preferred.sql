-- 経験者優遇トグル（2026-07-18）：はじめてOK・リピート即決と同列のフラグ。必要経験の選択式は撤回
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS experienced_preferred boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.jobs.experienced_preferred IS '💪経験者優遇バッジ（2026-07-18）。beginner_ok・instant_approve_repeatと同列のトグル';

CREATE OR REPLACE VIEW public.jobs_public AS
 SELECT job_number, crop, task, prefecture, city, town,
        date_label, date_start, date_end, headcount,
        pay_type, hourly_wage, daily_wage, work_time, break_time,
        nearest_station, commute_time, job_exp, notes, belongings, cautions,
        danger_places, danger_tasks, photos, created_at,
        lat, lng, geo_radius_m,
        full_pay_guarantee, beginner_ok, instant_approve_repeat,
        opened_at, perks, experienced_preferred
   FROM jobs
  WHERE status = 'open'::text;

CREATE OR REPLACE FUNCTION public.admin_preview_job(p_job_number integer)
 RETURNS SETOF jobs_public
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return;
  end if;
  return query
    select job_number, crop, task, prefecture, city, town,
           date_label, date_start, date_end, headcount,
           pay_type, hourly_wage, daily_wage, work_time, break_time,
           nearest_station, commute_time, job_exp, notes, belongings, cautions,
           danger_places, danger_tasks, photos, created_at,
           lat, lng, geo_radius_m,
           full_pay_guarantee, beginner_ok, instant_approve_repeat,
           opened_at, perks, experienced_preferred
      from public.jobs
     where jobs.job_number = p_job_number;
end;
$function$;

CREATE OR REPLACE FUNCTION public.employer_public_jobs(p_job_number integer)
 RETURNS SETOF jobs_public
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select job_number, crop, task, prefecture, city, town,
         date_label, date_start, date_end, headcount,
         pay_type, hourly_wage, daily_wage, work_time, break_time,
         nearest_station, commute_time, job_exp, notes, belongings, cautions,
         danger_places, danger_tasks, photos, created_at,
         lat, lng, geo_radius_m,
         full_pay_guarantee, beginner_ok, instant_approve_repeat,
         opened_at, perks, experienced_preferred
    from public.jobs
   where status = 'open'
     and farmer_id = (select farmer_id from public.jobs where job_number = p_job_number)
$function$;