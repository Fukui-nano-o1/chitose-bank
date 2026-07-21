-- admin_preview_job の列数不一致を修理（2026-07-16）。
-- 返り値は SETOF jobs_public のため、ビューに列を足すたび本体のSELECTも追従が必要。
-- 今回 full_pay_guarantee / beginner_ok / instant_approve_repeat の3列を追加（ビューと同順）
-- ※ビューを今後変更する時は、この関数のSELECTも必ず同時に更新すること
create or replace function public.admin_preview_job(p_job_number integer)
returns setof public.jobs_public
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 管理者チェック：app_admins に登録された者のみ
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return;  -- 非管理者には空を返す（存在も漏らさない）
  end if;

  return query
    select job_number, crop, task, prefecture, city, town,
           date_label, date_start, date_end, headcount,
           pay_type, hourly_wage, daily_wage, work_time, break_time,
           nearest_station, commute_time, job_exp, notes, belongings, cautions,
           danger_places, danger_tasks, photos, created_at,
           lat, lng, geo_radius_m,
           full_pay_guarantee, beginner_ok, instant_approve_repeat
      from public.jobs
     where jobs.job_number = p_job_number;
end;
$$;