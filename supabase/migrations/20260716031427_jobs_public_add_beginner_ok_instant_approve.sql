-- jobs_publicに beginner_ok / instant_approve_repeat を末尾追加。
-- create or replace は既存grant(authenticated SELECT)と WHERE status='open' を維持する。列は末尾追加のみ（既存列の順序・型は不変）
create or replace view public.jobs_public as
 select job_number, crop, task, prefecture, city, town, date_label, date_start, date_end,
        headcount, pay_type, hourly_wage, daily_wage, work_time, break_time,
        nearest_station, commute_time, job_exp, notes, belongings, cautions,
        danger_places, danger_tasks, photos, created_at, lat, lng, geo_radius_m,
        full_pay_guarantee, beginner_ok, instant_approve_repeat
   from jobs
  where status = 'open'::text;