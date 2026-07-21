-- 求人ごとの待遇（2026-07-18）：NULL=農家プロフィールの待遇を使う（従来通り）。
-- 非NULL=この求人だけの待遇（キーはemployer_profilesの待遇項目と同名）
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS perks jsonb;
COMMENT ON COLUMN public.jobs.perks IS 'この求人だけの待遇上書き。NULL=プロフィールの待遇。キー: has_transport/transport_area/has_parking/parking_capacity/has_commute_allowance/commute_allowance_detail/has_bonus/employer_pays_supplies/supplies_cap/accessory_ok';

-- ビュー末尾にperksを追加（末尾追加はCREATE OR REPLACEで可）
CREATE OR REPLACE VIEW public.jobs_public AS
 SELECT job_number, crop, task, prefecture, city, town,
        date_label, date_start, date_end, headcount,
        pay_type, hourly_wage, daily_wage, work_time, break_time,
        nearest_station, commute_time, job_exp, notes, belongings, cautions,
        danger_places, danger_tasks, photos, created_at,
        lat, lng, geo_radius_m,
        full_pay_guarantee, beginner_ok, instant_approve_repeat,
        opened_at, perks
   FROM jobs
  WHERE status = 'open'::text;

-- SETOF jobs_publicを返す2本のRPCも同時更新（固定カラム列挙のため・過去の教訓）
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
           opened_at, perks
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
         opened_at, perks
    from public.jobs
   where status = 'open'
     and farmer_id = (select farmer_id from public.jobs where job_number = p_job_number)
$function$;