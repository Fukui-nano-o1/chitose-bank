-- 審査用プレビュー：管理者のみ、pending/draft を含む求人1件を jobs_public と同じ列構成で取得する。
-- 働き手が見る姿と同じデータ形を返すことで、既存の求人詳細UIをそのまま流用できるようにする。
create or replace function public.admin_preview_job(p_job_number int)
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
           lat, lng, geo_radius_m
      from public.jobs
     where job_number = p_job_number;
end;
$$;

grant execute on function public.admin_preview_job(int) to authenticated;