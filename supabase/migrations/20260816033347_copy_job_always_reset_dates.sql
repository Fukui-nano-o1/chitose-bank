-- コピーは期間のみリセット（2026-08-16たきと指示「コピーは期間のみリセット。他はそのまま引き継いで」）
-- 従来：元の作業日程が過去の場合のみ日程を空にしていた（v_past判定・dates_cleared）。
-- 変更：コピーでは常に期間（date_label / date_start / date_end）と休日（holidays）を空にする。
--       期間以外（作物・作業・場所・報酬・勤務時間・写真・危険箇所・持ち物・待遇・時間外等）は従来どおり引き継ぐ。
--       ※休日も空にする理由：休日は期間の中の日付so、期間を捨てれば意味を失う（残すと新しい期間に古い休日が混ざる）。
-- 返り値の dates_cleared は互換のため残す（常にtrue）。旧ビルドのクライアントは旧文言のalertを出すが実害なし。
create or replace function public.copy_job(p_job_number integer)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid; v_src public.jobs; v_new public.jobs;
begin
  v_uid := auth.uid();
  if v_uid is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  select * into v_src from public.jobs where job_number = p_job_number;
  if v_src.job_number is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_src.farmer_id <> v_uid then return json_build_object('ok', false, 'reason', 'not_yours'); end if;

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
    null, null, null,  -- 期間は常にリセット（日程は新しく選び直す）
    11,
    v_src.headcount, v_src.pay_type, v_src.hourly_wage, v_src.daily_wage, v_src.work_time, v_src.break_time, v_src.nearest_station, v_src.commute_time,
    v_src.job_exp, v_src.notes, v_src.belongings, v_src.cautions, v_src.danger_places, v_src.danger_tasks, v_src.photos,
    v_src.lat, v_src.lng, v_src.geocoded_from, v_src.geo_radius_m,
    v_src.full_pay_guarantee, v_src.beginner_ok, v_src.instant_approve_repeat, v_src.experienced_preferred, v_src.perks,
    '[]'::jsonb,  -- 休日も期間と一心同体soリセット
    v_src.overtime_policy, v_src.overtime_detail
  ) returning * into v_new;

  return json_build_object('ok', true, 'job_number', v_new.job_number, 'dates_cleared', true,
                           'job', to_jsonb(v_new));
end; $function$;
