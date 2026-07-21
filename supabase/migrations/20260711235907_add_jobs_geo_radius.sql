-- 地図に描く円の半径（メートル）。町域の広がりから算出する。
-- ピンではなく円を描くことで「このあたり」を示し、「ここ」を示さない。
alter table public.jobs add column if not exists geo_radius_m integer;

comment on column public.jobs.geo_radius_m is '地図の円の半径（m）。町域内の各字の座標のばらつきから算出。番地レベルの精度を持たせてはならない。';

create or replace view public.jobs_public as
  select job_number, crop, task, prefecture, city, town,
         date_label, date_start, date_end, headcount,
         pay_type, hourly_wage, daily_wage, work_time, break_time,
         nearest_station, commute_time, job_exp, notes, belongings, cautions,
         danger_places, danger_tasks, photos, created_at,
         lat, lng, geo_radius_m
    from public.jobs
   where status = 'open'::text;