-- 同じ雇い手の公開求人一覧（受け入れ実績タップ→過去の求人ボックス用・2026-07-16）。
-- farmer_idは返さない（jobs_public同型）。返すのはstatus='open'のみ＝下書き・審査中は漏れない。
-- 「終了」判定は日付からクライアント側で導出する。
-- ※jobs_publicビューに列を足す時は、この関数とadmin_preview_jobのSELECTも必ず同時更新すること
create or replace function public.employer_public_jobs(p_job_number integer)
returns setof public.jobs_public
language sql
security definer
set search_path = public
as $$
  select job_number, crop, task, prefecture, city, town,
         date_label, date_start, date_end, headcount,
         pay_type, hourly_wage, daily_wage, work_time, break_time,
         nearest_station, commute_time, job_exp, notes, belongings, cautions,
         danger_places, danger_tasks, photos, created_at,
         lat, lng, geo_radius_m,
         full_pay_guarantee, beginner_ok, instant_approve_repeat
    from public.jobs
   where status = 'open'
     and farmer_id = (select farmer_id from public.jobs where job_number = p_job_number)
$$;
grant execute on function public.employer_public_jobs(integer) to authenticated;