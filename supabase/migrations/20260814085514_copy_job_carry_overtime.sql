-- copy_job：時間外労働（overtime_policy / overtime_detail）を複製に引き継ぐ（2026-08-14 バグ修理）
--
-- 【発見の経緯】承認プロセス削除後のバグ狩り（実弾ブロックD・Q4）：コピー→publish_my_job で
--   「時間外労働の有無の入力が必要です」で公開that止まった。コピー元には値thatあるのに、
--   copy_job のINSERT列挙に overtime_policy / overtime_detail（2026-08-03新設）that入っておらず
--   複製で静かに落ちていた＝農家は理由が分からないまま再入力を求められる。
-- 【型】「列を足したら関連関数も直す」（2026-07-22ルールのcopy_job版）。
--   他の新列は掲載時にトリガーthat自動確定するもの（pay_method等・募集主・スナップショット）や
--   複製すべきでないもの（opened_at・unlisted_reason）so、漏れはこの2列だけ（定義を全列照合済み）。
-- 【方針】既存定義そのまま＋2列を追記。日程が過ぎた求人の日付クリア等の挙動は不変。

create or replace function public.copy_job(p_job_number integer)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid; v_src public.jobs; v_new public.jobs; v_past boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  select * into v_src from public.jobs where job_number = p_job_number;
  if v_src.job_number is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_src.farmer_id <> v_uid then return json_build_object('ok', false, 'reason', 'not_yours'); end if;

  -- 日程that過ぎているか（終了日・無ければ開始日で判定）。日程未設定はfalse
  v_past := coalesce(coalesce(v_src.date_end, v_src.date_start) < (now() at time zone 'Asia/Tokyo')::date, false);

  insert into public.jobs (
    farmer_id, status,
    crop, task, zip, prefecture, city, address, town, date_label, date_start, date_end, draft_step,
    headcount, pay_type, hourly_wage, daily_wage, work_time, break_time, nearest_station, commute_time,
    job_exp, notes, belongings, cautions, danger_places, danger_tasks, photos,
    lat, lng, geocoded_from, geo_radius_m,
    full_pay_guarantee, beginner_ok, instant_approve_repeat, experienced_preferred, perks, holidays,
    overtime_policy, overtime_detail
  ) values (
    v_uid, 'draft',
    v_src.crop, v_src.task, v_src.zip, v_src.prefecture, v_src.city, v_src.address, v_src.town,
    case when v_past then null else v_src.date_label end,
    case when v_past then null else v_src.date_start end,
    case when v_past then null else v_src.date_end end,
    11,
    v_src.headcount, v_src.pay_type, v_src.hourly_wage, v_src.daily_wage, v_src.work_time, v_src.break_time, v_src.nearest_station, v_src.commute_time,
    v_src.job_exp, v_src.notes, v_src.belongings, v_src.cautions, v_src.danger_places, v_src.danger_tasks, v_src.photos,
    v_src.lat, v_src.lng, v_src.geocoded_from, v_src.geo_radius_m,
    v_src.full_pay_guarantee, v_src.beginner_ok, v_src.instant_approve_repeat, v_src.experienced_preferred, v_src.perks,
    case when v_past then '[]'::jsonb else coalesce(v_src.holidays, '[]'::jsonb) end,
    v_src.overtime_policy, v_src.overtime_detail
  ) returning * into v_new;

  return json_build_object('ok', true, 'job_number', v_new.job_number, 'dates_cleared', v_past,
                           'job', to_jsonb(v_new));
end; $function$;
