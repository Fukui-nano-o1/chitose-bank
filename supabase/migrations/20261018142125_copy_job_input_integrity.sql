-- Preserve input on a new draft; consent for a different job must be confirmed again.
-- Public/pending jobs still require the same complete consent. No existing row is rewritten.
begin;
alter table public.jobs drop constraint jobs_work_video_consent_check;
alter table public.jobs add constraint jobs_work_video_consent_check check (
  work_video_url is null or (
    work_video_job_consent is true and work_video_consent_at is not null
    and nullif(btrim(work_video_consent_version), '') is not null
  ) or (
    status is not distinct from 'draft' and work_video_job_consent is not true
    and work_video_related_consent is not true and work_video_consent_at is null
    and work_video_consent_version is null
  )
);
CREATE OR REPLACE FUNCTION public.copy_job(p_job_number integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    overtime_policy, overtime_detail, place_change_scope, task_change_scope,
    work_video_url, work_video_job_consent, work_video_related_consent, work_video_consent_at, work_video_consent_version, draft_step_id
  ) values (
    v_uid, 'draft',
    v_src.crop, v_src.task, v_src.zip, v_src.prefecture, v_src.city, v_src.address, v_src.town,
    null, null, null,
    12,
    v_src.headcount, v_src.pay_type, v_src.hourly_wage, v_src.daily_wage, v_src.work_time, v_src.break_time, v_src.nearest_station, v_src.commute_time,
    v_src.job_exp, v_src.notes, v_src.belongings, v_src.cautions, v_src.danger_places, v_src.danger_tasks, v_src.photos,
    v_src.lat, v_src.lng, v_src.geocoded_from, v_src.geo_radius_m,
    v_src.full_pay_guarantee, v_src.beginner_ok, v_src.instant_approve_repeat, v_src.experienced_preferred, v_src.perks,
    '[]'::jsonb,
    v_src.overtime_policy, v_src.overtime_detail, v_src.place_change_scope, v_src.task_change_scope,
    v_src.work_video_url, false, false, null, null, 'review'
  ) returning * into v_new;

  return json_build_object('ok', true, 'job_number', v_new.job_number, 'dates_cleared', true,
                           'video_reconfirmation_required', v_new.work_video_url is not null, 'job', to_jsonb(v_new));
end; $function$;
commit;
