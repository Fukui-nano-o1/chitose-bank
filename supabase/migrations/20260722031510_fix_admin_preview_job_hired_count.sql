-- admin_preview_job は RETURNS SETOF jobs_public。2026-07-21に jobs_public へ hired_count を
-- 追加した結果、本関数の SELECT(34列) が戻り型(35列)と不一致になり実行時エラー
-- （42804 structure of query does not match function result type）で審査プレビューが
-- 「求人が見つかりません」になっていた。hired_count をビューと同じ式で末尾に追加して復旧する。
create or replace function public.admin_preview_job(p_job_number integer)
 returns setof jobs_public
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
           opened_at, perks, experienced_preferred,
           (select count(*) from public.applications a
             where a.job_number = jobs.job_number
               and a.terms_confirmed_worker_at is not null
               and a.terms_confirmed_farmer_at is not null) as hired_count
      from public.jobs
     where jobs.job_number = p_job_number;
end;
$function$;
