-- 分析ダッシュボードのデータ蛇口：日別系列（管理者専用・計測対象のみ）
create or replace function public.admin_analytics_series(p_days int default 30)
returns table(d date, new_users int, job_views int, apps int, completions int, nsm_hours numeric)
language sql stable security definer set search_path = public as $$
  with days as (
    select generate_series(
      (now() at time zone 'Asia/Tokyo')::date - (p_days - 1),
      (now() at time zone 'Asia/Tokyo')::date, '1 day')::date as d
  )
  select
    days.d,
    coalesce((select count(*) from auth.users u
       where (u.created_at at time zone 'Asia/Tokyo')::date = days.d
         and public.is_measured(u.id)), 0)::int,
    coalesce((select count(*) from public.page_events e
       where (e.ts at time zone 'Asia/Tokyo')::date = days.d
         and e.page_hash like '%/work/job/%' and public.is_measured(e.auth_id)), 0)::int,
    coalesce((select count(*) from public.applications a
       where (a.created_at at time zone 'Asia/Tokyo')::date = days.d
         and public.is_measured(a.worker_id)), 0)::int,
    coalesce((select count(*) from public.applications a
       where a.status='completed' and coalesce(a.attended,true)
         and (a.work_completed_at at time zone 'Asia/Tokyo')::date = days.d
         and public.is_measured(a.worker_id)), 0)::int,
    coalesce((select sum((split_part(split_part(j.work_time,'〜',2),':',1)::int * 60
            + split_part(split_part(j.work_time,'〜',2),':',2)::int
            - split_part(split_part(j.work_time,'〜',1),':',1)::int * 60
            - split_part(split_part(j.work_time,'〜',1),':',2)::int) / 60.0)
       from public.applications a join public.jobs j on j.job_number = a.job_number
       where a.status='completed' and coalesce(a.attended,true)
         and j.work_time ~ '^\d{1,2}:\d{2}〜\d{1,2}:\d{2}'
         and (a.work_completed_at at time zone 'Asia/Tokyo')::date = days.d
         and public.is_measured(a.worker_id)), 0)
  from days
  where exists (select 1 from public.app_admins a where a.auth_id = auth.uid())
  order by days.d;
$$;