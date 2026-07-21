-- 集合場所の座標。町域レベルの精度のみを保持する。
-- 番地（jobs.address）はジオコーディングに渡さない。正確な位置は承認後にチャットで伝える。
alter table public.jobs add column if not exists lat numeric;
alter table public.jobs add column if not exists lng numeric;
alter table public.jobs add column if not exists geocoded_from text;

comment on column public.jobs.lat is '緯度。町域レベルの精度のみ。番地から算出してはならない。';
comment on column public.jobs.lng is '経度。町域レベルの精度のみ。番地から算出してはならない。';
comment on column public.jobs.geocoded_from is 'ジオコーディングに渡した住所文字列（prefecture+city+townのみ）。addressを含めてはならない。';

-- 既存列の順序を保ったまま末尾に lat/lng を追加する。
-- create or replace を使うことで権限（anon:SELECT のみ）が保持される。
-- ※DROP して CREATE すると Supabase のデフォルト権限が anon にフル権限を付与するため危険。
create or replace view public.jobs_public as
  select job_number,
         crop,
         task,
         prefecture,
         city,
         town,
         date_label,
         date_start,
         date_end,
         headcount,
         pay_type,
         hourly_wage,
         daily_wage,
         work_time,
         break_time,
         nearest_station,
         commute_time,
         job_exp,
         notes,
         belongings,
         cautions,
         danger_places,
         danger_tasks,
         photos,
         created_at,
         lat,
         lng
    from public.jobs
   where status = 'open'::text;