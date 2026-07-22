-- employer_public_jobs も RETURNS SETOF jobs_public。同じく2026-07-21のhired_count追加で
-- 34列SELECTが戻り型(35列)と不一致になり、雇い手プロフィールの「過去の求人」ボックスが
-- 実行時エラーになっていた。hired_count をビューと同じ式で末尾に追加して復旧する。
create or replace function public.employer_public_jobs(p_job_number integer)
 returns setof jobs_public
 language sql
 security definer
 set search_path to 'public'
as $function$
  select job_number, crop, task, prefecture, city, town,
         date_label, date_start, date_end, headcount,
         pay_type, hourly_wage, daily_wage, work_time, break_time,
         nearest_station, commute_time, job_exp, notes, belongings, cautions,
         danger_places, danger_tasks, photos, created_at,
         lat, lng, geo_radius_m,
         full_pay_guarantee, beginner_ok, instant_approve_repeat,
         opened_at, perks, experienced_preferred,
         (select count(*) from public.applications a
           where a.job_number = jobs.job_number
             and a.terms_confirmed_worker_at is not null
             and a.terms_confirmed_farmer_at is not null) as hired_count
    from public.jobs
   where status = 'open'
     and farmer_id = (select farmer_id from public.jobs where job_number = p_job_number)
$function$;
