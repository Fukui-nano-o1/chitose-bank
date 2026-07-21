-- 新着バッジ用の掲載時刻（2026-07-16）：status→open遷移の瞬間を opened_at に刻む
alter table public.jobs add column opened_at timestamptz;

create or replace function public.set_job_opened_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') and new.opened_at is null then
    new.opened_at := now();
  end if;
  return new;
end; $$;

create trigger trg_set_job_opened_at_upd before update on public.jobs
  for each row execute function public.set_job_opened_at();
create trigger trg_set_job_opened_at_ins before insert on public.jobs
  for each row execute function public.set_job_opened_at();

-- 既存の公開中求人は created_at で近似backfill（実際の承認時刻は記録が無いため）
update public.jobs set opened_at = created_at where status = 'open' and opened_at is null;

-- jobs_public に opened_at を末尾追加（CREATE OR REPLACE＝既存grant/フィルタ維持）
create or replace view public.jobs_public as
select job_number, crop, task, prefecture, city, town,
       date_label, date_start, date_end, headcount,
       pay_type, hourly_wage, daily_wage, work_time, break_time,
       nearest_station, commute_time, job_exp, notes, belongings, cautions,
       danger_places, danger_tasks, photos, created_at,
       lat, lng, geo_radius_m,
       full_pay_guarantee, beginner_ok, instant_approve_repeat,
       opened_at
  from jobs
 where status = 'open';

-- ★列結合の罠：SETOF jobs_public を返す2関数のSELECT列もビューと同時に揃える（過去に不一致で実行時エラー）
create or replace function public.admin_preview_job(p_job_number integer)
returns setof jobs_public
language plpgsql security definer set search_path to 'public' as $function$
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
           opened_at
      from public.jobs
     where jobs.job_number = p_job_number;
end;
$function$;

create or replace function public.employer_public_jobs(p_job_number integer)
returns setof jobs_public
language sql security definer set search_path to 'public' as $function$
  select job_number, crop, task, prefecture, city, town,
         date_label, date_start, date_end, headcount,
         pay_type, hourly_wage, daily_wage, work_time, break_time,
         nearest_station, commute_time, job_exp, notes, belongings, cautions,
         danger_places, danger_tasks, photos, created_at,
         lat, lng, geo_radius_m,
         full_pay_guarantee, beginner_ok, instant_approve_repeat,
         opened_at
    from public.jobs
   where status = 'open'
     and farmer_id = (select farmer_id from public.jobs where job_number = p_job_number)
$function$;