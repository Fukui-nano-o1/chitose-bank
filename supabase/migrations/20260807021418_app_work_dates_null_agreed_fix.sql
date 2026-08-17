-- app_work_dates の実害修理（2026-08-07・ラベル化②の回帰検証が発見）
--
-- 【何が問題だったか】agreed_dates が SQL NULL（＝単日求人・日程未合意の応募＝標準ケース）のとき、
-- 求人範囲へのフォールバック条件 `not (jsonb_typeof(a.agreed_dates)='array' and ...)` が
-- NULL に評価され（jsonb_typeof(NULL)=NULL）、行が落ちて【空集合】を返していた。
-- 結果＝confirm_terms の二重予約の壁が、標準ケースで無音のまま素通り
-- （実測：同日の単日求人2本・両方承認済みで accept=false の採用が double_booked にならず通った）。
-- agreed_dates が入っている期間求人だけで検証すると見えない型。
-- 2026-07-29 auth.uid() フェイルオープンと同族＝【NULLを先に潰す】教訓のjsonb版。
--
-- 【修理】フォールバック条件を coalesce(..., false) で包む（NULL→false＝フォールバックする側に倒す）。
-- agreed_dates非空配列の挙動・holidays除外は不変。土台は現本番定義。

create or replace function public.app_work_dates(p_app uuid)
returns setof date
language sql
stable
security definer
set search_path to 'public'
as $function$
  with a as (
    select ap.agreed_dates, j.date_start, j.date_end, j.holidays
      from public.applications ap
      join public.jobs j on j.job_number = ap.job_number
     where ap.id = p_app
  ),
  hol as (
    select d::date as hd
      from a, lateral (select case when jsonb_typeof(a.holidays)='array' then a.holidays else '[]'::jsonb end as h) hh,
           jsonb_array_elements_text(hh.h) d
  ),
  days as (
    -- agreed_dates（非空配列）があればそれを使う
    select d::date as wd
      from a, jsonb_array_elements_text(a.agreed_dates) d
     where jsonb_typeof(a.agreed_dates)='array' and jsonb_array_length(a.agreed_dates) > 0
    union all
    -- 無ければ求人範囲を展開（★agreed_dates=NULLもこちらへ。coalesceでNULLをfalseに倒す）
    select gs::date
      from a, generate_series(a.date_start, coalesce(a.date_end, a.date_start), interval '1 day') gs
     where not coalesce(jsonb_typeof(a.agreed_dates)='array' and jsonb_array_length(a.agreed_dates) > 0, false)
       and a.date_start is not null
  )
  select distinct wd from days
   where wd not in (select hd from hol);
$function$;
