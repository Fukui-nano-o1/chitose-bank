-- Read-only production function snapshot, 2026-10-18; no user rows or credentials.
-- Applied only to the local PGlite fixtures, before the reviewed migrations.
CREATE OR REPLACE FUNCTION public.publish_my_job(p_job_number integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_farmer uuid; v_status text; v_rev timestamptz;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  if public.is_account_moderated(auth.uid()) then
    return json_build_object('ok', false, 'reason', 'account_suspended');
  end if;
  select farmer_id, status, revision_requested_at into v_farmer, v_status, v_rev
    from public.jobs where job_number = p_job_number;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_farmer <> auth.uid() then return json_build_object('ok', false, 'reason', 'not_yours'); end if;
  if v_status = 'open' then return json_build_object('ok', true, 'already', true); end if;
  if v_status not in ('draft','pending') then return json_build_object('ok', false, 'reason', 'bad_status'); end if;

  if v_rev is not null then
    update public.jobs set status = 'pending' where job_number = p_job_number;
    begin
      perform public.notify_admins(
        'job_revision_resubmitted',
        '修正のお願い中の求人が再掲載されました（要確認）：#' || p_job_number);
      perform public.send_admin_email(
        '[要確認] 修正のお願い中の求人 #' || p_job_number || ' が再掲載されました',
        '修正のお願い（' || to_char(v_rev at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') || '）中の求人が再掲載されました。' || E'\n' ||
        '内容を確認し、問題がなければ公開してください（公開でフラグは自動で消えます）。' || E'\n\n' ||
        '確認：https://chitose-bank.com/#/admin/review/' || p_job_number);
    exception when others then null; end;
    return json_build_object('ok', true, 'pending', true, 'reason', 'revision_requested');
  end if;

  update public.jobs set status = 'open' where job_number = p_job_number;
  return json_build_object('ok', true);
end; $function$;

CREATE OR REPLACE FUNCTION public.sync_my_open_job(p_owner uuid, p_id uuid, p_expected jsonb, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_job public.jobs%rowtype;
  v_allowed text[] := array['crop','task','zip','prefecture','city','town','address','date_label','date_start','date_end','holidays','headcount','pay_type','hourly_wage','daily_wage','work_time','break_time','nearest_station','commute_time','job_exp','beginner_ok','instant_approve_repeat','perks','experienced_preferred','notes','belongings','cautions','overtime_policy','overtime_detail','place_change_scope','task_change_scope','danger_places','danger_tasks','photos','work_video_url','work_video_job_consent','work_video_related_consent','work_video_consent_at','work_video_consent_version','draft_step','draft_step_id','lat','lng','geo_radius_m','geocoded_from'];
  v_current jsonb;
  v_result jsonb;
begin
  if v_uid is null or v_uid is distinct from p_owner then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    return jsonb_build_object('ok',false,'reason','bad_patch');
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k <> all(v_allowed)) then
    return jsonb_build_object('ok',false,'reason','bad_field');
  end if;
  if not exists (select 1 from public.account_holders a
                 where a.auth_id=v_uid and a.agreed_privacy_version=public.current_privacy_version()) then
    return jsonb_build_object('ok',false,'reason','consent_required');
  end if;
  select * into v_job from public.jobs where id=p_id and farmer_id=v_uid for update;
  if not found then return jsonb_build_object('ok',false,'reason','conflict','row',null); end if;
  if v_job.status <> 'open' then return jsonb_build_object('ok',false,'reason','conflict','row',to_jsonb(v_job)); end if;
  if to_jsonb(v_job) @> (p_patch - 'draft_step') then
    return jsonb_build_object('ok',true,'row',to_jsonb(v_job));
  end if;
  select jsonb_object_agg(key,value) into v_current from jsonb_each(to_jsonb(v_job))
    where key = any(v_allowed || array['status']);
  if p_expected is null or v_current is distinct from p_expected then
    return jsonb_build_object('ok',false,'reason','conflict','row',to_jsonb(v_job));
  end if;
  v_result := public.update_my_open_job(v_job.job_number, p_patch - 'draft_step')::jsonb;
  if not coalesce((v_result->>'ok')::boolean,false) then return v_result; end if;
  select * into v_job from public.jobs where id=p_id and farmer_id=v_uid;
  return jsonb_build_object('ok',true,'row',to_jsonb(v_job));
end $function$;

CREATE OR REPLACE FUNCTION public.sync_my_job_draft(p_owner uuid, p_id uuid, p_expected jsonb, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_job public.jobs%rowtype;
  v_allowed text[] := array['crop','task','zip','prefecture','city','town','address','date_label','date_start','date_end','holidays','headcount','pay_type','hourly_wage','daily_wage','work_time','break_time','nearest_station','commute_time','job_exp','beginner_ok','instant_approve_repeat','perks','experienced_preferred','notes','belongings','cautions','overtime_policy','overtime_detail','place_change_scope','task_change_scope','danger_places','danger_tasks','photos','work_video_url','work_video_job_consent','work_video_related_consent','work_video_consent_at','work_video_consent_version','draft_step','draft_step_id','lat','lng','geo_radius_m','geocoded_from'];
  v_current jsonb;
  v_columns text;
  v_values text;
begin
  if v_uid is null or v_uid is distinct from p_owner then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  if p_id is null or p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    return jsonb_build_object('ok',false,'reason','bad_patch');
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k <> all(v_allowed)) then
    return jsonb_build_object('ok',false,'reason','bad_field');
  end if;
  if not exists (select 1 from public.account_holders a
                 where a.auth_id=v_uid and a.agreed_privacy_version=public.current_privacy_version()) then
    return jsonb_build_object('ok',false,'reason','consent_required');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_job from public.jobs where id=p_id and farmer_id=v_uid;
  if found and v_job.status not in ('draft','pending') then
    return jsonb_build_object('ok',false,'reason','conflict','row',to_jsonb(v_job));
  end if;
  select * into v_job from public.jobs where id=p_id and farmer_id=v_uid for update;
  if found then
    if v_job.status='draft' and to_jsonb(v_job) @> p_patch then
      return jsonb_build_object('ok',true,'row',to_jsonb(v_job));
    end if;
    select jsonb_object_agg(key,value) into v_current from jsonb_each(to_jsonb(v_job))
      where key = any(v_allowed || array['status']);
    if p_expected is null or v_current is distinct from p_expected then
      return jsonb_build_object('ok',false,'reason','conflict','row',to_jsonb(v_job));
    end if;
    select string_agg(format('%I',k),',' order by k), string_agg(format('r.%I',k),',' order by k)
      into v_columns,v_values from jsonb_object_keys(p_patch) k;
    execute format('update public.jobs set (%s)=(select %s from jsonb_populate_record(null::public.jobs,$1) r),status=''draft'' where id=$2 and farmer_id=$3 returning *',v_columns,v_values)
      into v_job using p_patch,p_id,v_uid;
  else
    if p_expected is not null then return jsonb_build_object('ok',false,'reason','conflict','row',null); end if;
    select string_agg(format('%I',k),',' order by k), string_agg(format('r.%I',k),',' order by k)
      into v_columns,v_values from jsonb_object_keys(p_patch) k;
    execute format('insert into public.jobs(id,farmer_id,status,%s) select $1,$2,''draft'',%s from jsonb_populate_record(null::public.jobs,$3) r returning *',v_columns,v_values)
      into v_job using p_id,v_uid,p_patch;
  end if;
  if v_job.id is null then return jsonb_build_object('ok',false,'reason','not_confirmed'); end if;
  return jsonb_build_object('ok',true,'row',to_jsonb(v_job));
end $function$;
