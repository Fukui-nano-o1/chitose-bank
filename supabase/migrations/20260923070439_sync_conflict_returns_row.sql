-- 2026-09-23 同期の「conflict」に現在の行を添える（本人の行だけ・可視範囲は不変）。
-- 【何が起きていたか】カレンダーの「この日にコピー」は、copy_job が返した行に離した日を重ねて
-- 端末の比較元(base)にしていた。DBの下書きは日程が空なので、掲載時の sync_my_job_draft が
-- p_expected≠現在の行 で conflict を返し、端末の記録が conflict のまま解除されず、
-- 2回目の「掲載する」が DRAFT_REQUIRES_REVIEW（管理者には生の文字・一般には無反応）で止まっていた。
-- 【この migration】conflict の返り値に 'row'（本人の現在の行・無ければ null）を添える＝
-- 端末側が比較元を取り直し、利用者の明示の操作（掲載する／保存）で再送できる。
-- 返す行は auth.uid()=farmer_id の自分の行だけ（RLS owner select と同じ範囲）。
-- 機能・壁（本人・同意版・許可列・open の応募なし）は不変。
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
  -- ★下書きでない自分の行（掲載済み open・終了 closed 等）は、RLS「owner update draft」の対象外なので
  --   for update では見えない（＝旧版では not found → 同じUUIDの再INSERTで主キー違反になった）。
  --   先に素の select（owner select＝自分の行は状態を問わず見える）で状態を確かめ、現在の行を添えて返す
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
end $$;
revoke all on function public.sync_my_open_job(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.sync_my_open_job(uuid,uuid,jsonb,jsonb) to authenticated;

