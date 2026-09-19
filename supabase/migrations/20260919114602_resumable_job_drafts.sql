-- app_settings はRLSにより非公開。現行版数だけを返す読み取り専用の窓口。
create or replace function public.current_privacy_version()
returns text language sql stable security definer set search_path = '' as $$
  select value from public.app_settings where key='privacy_version'
$$;
revoke all on function public.current_privacy_version() from public,anon;
grant execute on function public.current_privacy_version() to authenticated;

-- 通信復旧後の求人保存。本人・同じUUID・読込時の内容をDB内で照合する。
-- 既存のRLS/掲載検査を広げない。応答が消えた再送は同じ内容なら結果を返す。
create or replace function public.sync_my_job_draft(p_owner uuid, p_id uuid, p_expected jsonb, p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_job public.jobs%rowtype;
  v_allowed text[] := array['crop','task','zip','prefecture','city','town','address','date_label','date_start','date_end','holidays','headcount','pay_type','hourly_wage','daily_wage','work_time','break_time','nearest_station','commute_time','job_exp','beginner_ok','instant_approve_repeat','perks','experienced_preferred','notes','belongings','cautions','overtime_policy','overtime_detail','place_change_scope','task_change_scope','danger_places','danger_tasks','photos','draft_step','lat','lng','geo_radius_m','geocoded_from'];
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
  -- 新規の同じUUIDも直列化。外部I/Oを行わず、この短いトランザクション内だけロック。
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_job from public.jobs where id=p_id and farmer_id=v_uid for update;
  if found then
    if v_job.status not in ('draft','pending') then return jsonb_build_object('ok',false,'reason','conflict'); end if;
    if v_job.status='draft' and to_jsonb(v_job) @> p_patch then
      return jsonb_build_object('ok',true,'row',to_jsonb(v_job));
    end if;
    select jsonb_object_agg(key,value) into v_current from jsonb_each(to_jsonb(v_job))
      where key = any(v_allowed || array['status']);
    if p_expected is null or v_current is distinct from p_expected then
      return jsonb_build_object('ok',false,'reason','conflict');
    end if;
    select string_agg(format('%I',k),',' order by k), string_agg(format('r.%I',k),',' order by k)
      into v_columns,v_values from jsonb_object_keys(p_patch) k;
    execute format('update public.jobs set (%s)=(select %s from jsonb_populate_record(null::public.jobs,$1) r),status=''draft'' where id=$2 and farmer_id=$3 returning *',v_columns,v_values)
      into v_job using p_patch,p_id,v_uid;
  else
    if p_expected is not null then return jsonb_build_object('ok',false,'reason','conflict'); end if;
    select string_agg(format('%I',k),',' order by k), string_agg(format('r.%I',k),',' order by k)
      into v_columns,v_values from jsonb_object_keys(p_patch) k;
    execute format('insert into public.jobs(id,farmer_id,status,%s) select $1,$2,''draft'',%s from jsonb_populate_record(null::public.jobs,$3) r returning *',v_columns,v_values)
      into v_job using p_id,v_uid,p_patch;
  end if;
  if v_job.id is null then return jsonb_build_object('ok',false,'reason','not_confirmed'); end if;
  return jsonb_build_object('ok',true,'row',to_jsonb(v_job));
end $$;
revoke all on function public.sync_my_job_draft(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.sync_my_job_draft(uuid,uuid,jsonb,jsonb) to authenticated;

-- 公開中は既存の専用窓口だけを使用。所有者とスナップショットを行ロック下で確認する。
create or replace function public.sync_my_open_job(p_owner uuid, p_id uuid, p_expected jsonb, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_job public.jobs%rowtype;
  v_allowed text[] := array['crop','task','zip','prefecture','city','town','address','date_label','date_start','date_end','holidays','headcount','pay_type','hourly_wage','daily_wage','work_time','break_time','nearest_station','commute_time','job_exp','beginner_ok','instant_approve_repeat','perks','experienced_preferred','notes','belongings','cautions','overtime_policy','overtime_detail','place_change_scope','task_change_scope','danger_places','danger_tasks','photos','draft_step','lat','lng','geo_radius_m','geocoded_from'];
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
  if not found or v_job.status <> 'open' then return jsonb_build_object('ok',false,'reason','conflict'); end if;
  if to_jsonb(v_job) @> (p_patch - 'draft_step') then
    return jsonb_build_object('ok',true,'row',to_jsonb(v_job));
  end if;
  select jsonb_object_agg(key,value) into v_current from jsonb_each(to_jsonb(v_job))
    where key = any(v_allowed || array['status']);
  if p_expected is null or v_current is distinct from p_expected then
    return jsonb_build_object('ok',false,'reason','conflict');
  end if;
  v_result := public.update_my_open_job(v_job.job_number, p_patch - 'draft_step')::jsonb;
  if not coalesce((v_result->>'ok')::boolean,false) then return v_result; end if;
  select * into v_job from public.jobs where id=p_id and farmer_id=v_uid;
  return jsonb_build_object('ok',true,'row',to_jsonb(v_job));
end $$;
revoke all on function public.sync_my_open_job(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.sync_my_open_job(uuid,uuid,jsonb,jsonb) to authenticated;

-- 再送で同じ同意を重複更新しない。古いタブから旧版へ巻き戻すことも防ぐ。
create or replace function public.save_my_privacy_consent(p_auth_id uuid, p_version text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_version text;
begin
  if auth.uid() is null or auth.uid() is distinct from p_auth_id then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if p_version is null or p_version is distinct from public.current_privacy_version() then
    raise exception 'POLICY_CHANGED' using errcode='22023';
  end if;
  update public.account_holders set agreed_privacy_version=p_version
    where auth_id=auth.uid() and agreed_privacy_version is distinct from p_version;
  select agreed_privacy_version into v_version from public.account_holders where auth_id=auth.uid();
  return jsonb_build_object('agreed_privacy_version',v_version);
end $$;
revoke all on function public.save_my_privacy_consent(uuid,text) from public,anon;
grant execute on function public.save_my_privacy_consent(uuid,text) to authenticated;
