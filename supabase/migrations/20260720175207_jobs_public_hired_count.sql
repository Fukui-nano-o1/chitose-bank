-- 探すの求人カードに「募集終了（採用人数を満たした）」帯を出すため、採用成立数を公開ビューに追加（2026-07-21）
-- hired_count＝両者確認済み（採用成立）の応募数。集計値のみ（誰かは出さない）。除外はしない＝件数は減らさない
create or replace view public.jobs_public as
  select job_number, crop, task, prefecture, city, town, date_label, date_start, date_end,
         headcount, pay_type, hourly_wage, daily_wage, work_time, break_time, nearest_station,
         commute_time, job_exp, notes, belongings, cautions, danger_places, danger_tasks, photos,
         created_at, lat, lng, geo_radius_m, full_pay_guarantee, beginner_ok, instant_approve_repeat,
         opened_at, perks, experienced_preferred,
         (select count(*) from public.applications a
           where a.job_number = j.job_number
             and a.terms_confirmed_worker_at is not null
             and a.terms_confirmed_farmer_at is not null) as hired_count
    from public.jobs j
   where status = 'open' and not public.is_account_moderated(farmer_id);
revoke all on public.jobs_public from anon, authenticated;
grant select on public.jobs_public to authenticated;