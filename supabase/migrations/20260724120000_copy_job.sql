-- 過去の求人をコピー（2026-07-24）：自分の既存求人の内容を新しい下書き(status='draft')として複製する。
-- 本人限定（farmer_id=auth.uid()）。メタ（id/job_number/created_at/status/opened_at/revision_requested_at）はリセット。
-- 内容列（作物・作業・場所・報酬・写真・危険箇所・日程等）はそのままコピー。
-- draft_step=1 で複製し、編集ウィザードを頭から通して編集・調整できるようにする（確認ページ直行だと編集導線が分かりにくいため）。
create or replace function public.copy_job(p_job_number integer)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid; v_src public.jobs; v_new integer;
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
    full_pay_guarantee, beginner_ok, instant_approve_repeat, experienced_preferred, perks
  ) values (
    v_uid, 'draft',
    v_src.crop, v_src.task, v_src.zip, v_src.prefecture, v_src.city, v_src.address, v_src.town, v_src.date_label, v_src.date_start, v_src.date_end, 1,
    v_src.headcount, v_src.pay_type, v_src.hourly_wage, v_src.daily_wage, v_src.work_time, v_src.break_time, v_src.nearest_station, v_src.commute_time,
    v_src.job_exp, v_src.notes, v_src.belongings, v_src.cautions, v_src.danger_places, v_src.danger_tasks, v_src.photos,
    v_src.lat, v_src.lng, v_src.geocoded_from, v_src.geo_radius_m,
    v_src.full_pay_guarantee, v_src.beginner_ok, v_src.instant_approve_repeat, v_src.experienced_preferred, v_src.perks
  ) returning job_number into v_new;

  return json_build_object('ok', true, 'job_number', v_new);
end; $function$;
grant execute on function public.copy_job(integer) to authenticated;
