-- 掲載・確認台帳・操作IDを同じトランザクションで確定する。
-- 旧「掲載のみ」RPCは外部から閉じる。既存の公開条件・修正依頼時pending処理はその関数を内部利用する。
-- 適用には新クライアントとの協調切替が必要。既存の台帳を推測補完しない。
begin;
create schema if not exists private;
create table private.job_publication_requests (
  id uuid primary key,
  farmer_id uuid not null,
  job_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.job_publication_requests enable row level security;
revoke all on private.job_publication_requests from public,anon,authenticated;

create function private.publish_job_with_check(p_request_id uuid,p_job_id uuid,p_expected jsonb,p_items jsonb,p_agreed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $function$
declare
  v_uid uuid := auth.uid();
  v_job public.jobs%rowtype;
  v_previous private.job_publication_requests%rowtype;
  v_request jsonb;
  v_result jsonb;
  v_current jsonb;
  v_fields text[] := array['crop','task','zip','prefecture','city','town','address','date_label','date_start','date_end','holidays','headcount','pay_type','hourly_wage','daily_wage','work_time','break_time','nearest_station','commute_time','job_exp','beginner_ok','instant_approve_repeat','perks','experienced_preferred','notes','belongings','cautions','overtime_policy','overtime_detail','place_change_scope','task_change_scope','danger_places','danger_tasks','photos','work_video_url','work_video_job_consent','work_video_related_consent','work_video_consent_at','work_video_consent_version','draft_step','draft_step_id','lat','lng','geo_radius_m','geocoded_from','status'];
begin
  if v_uid is null then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  if p_request_id is null or p_job_id is null or p_agreed_at is null or not isfinite(p_agreed_at)
    or jsonb_typeof(p_expected) is distinct from 'object'
    or jsonb_typeof(p_items) is distinct from 'array' then
    return jsonb_build_object('ok',false,'reason','bad_confirmation');
  end if;
  if jsonb_array_length(p_items) not between 1 and 20 or exists(
    select 1 from jsonb_array_elements(p_items) i where jsonb_typeof(i) is distinct from 'object'
      or i->'checked' is distinct from 'true'::jsonb or jsonb_typeof(i->'text') is distinct from 'string'
      or length(btrim(i->>'text')) not between 1 and 2000
  ) then return jsonb_build_object('ok',false,'reason','bad_confirmation'); end if;
  if p_expected ? 'work_video_consent_at' then
    p_expected := p_expected || jsonb_build_object('work_video_consent_at',(p_expected->>'work_video_consent_at')::timestamptz);
  end if;
  v_request := jsonb_build_object('job_id',p_job_id,'expected',p_expected,'items',p_items,'agreed_at',p_agreed_at);
  -- 同じ操作IDと、下書き同期と同じ求人IDを直列化する。行ロックでも他の更新経路を防ぐ。
  perform pg_advisory_xact_lock(hashtextextended('publication:'||p_request_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(p_job_id::text,0));
  select * into v_job from public.jobs where id=p_job_id and farmer_id=v_uid for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  select * into v_previous from private.job_publication_requests where id=p_request_id;
  if found then
    if v_previous.farmer_id is distinct from v_uid or v_previous.job_id is distinct from p_job_id
      or v_previous.request is distinct from v_request then
      return jsonb_build_object('ok',false,'reason','request_mismatch');
    end if;
    -- 応答だけ失われた再送。今は終了/非公開になっていても再掲載しない。
    return v_previous.result || jsonb_build_object('row',to_jsonb(v_job));
  end if;
  if public.is_account_moderated(v_uid) then return jsonb_build_object('ok',false,'reason','account_suspended'); end if;
  if not exists(select 1 from public.account_holders where auth_id=v_uid and agreed_privacy_version=public.current_privacy_version()) then
    return jsonb_build_object('ok',false,'reason','consent_required');
  end if;
  if v_job.status not in ('draft','pending') then
    return jsonb_build_object('ok',false,'reason','bad_status');
  end if;
  select jsonb_object_agg(key,value) into v_current from jsonb_each(to_jsonb(v_job)) where key=any(v_fields);
  if v_current is distinct from p_expected then
    return jsonb_build_object('ok',false,'reason','conflict','row',to_jsonb(v_job));
  end if;
  begin
    v_result := public.publish_my_job(v_job.job_number)::jsonb;
    if not coalesce((v_result->>'ok')::boolean,false) then return v_result; end if;
    select * into v_job from public.jobs where id=p_job_id and farmer_id=v_uid;
    if v_job.status not in ('open','pending') then raise exception 'PUBLICATION_NOT_CONFIRMED'; end if;
    select jsonb_object_agg(key,value) into v_current from jsonb_each(to_jsonb(v_job)) where key=any(v_fields);
    -- この例外ブロック全体がロールバック単位。確認記録の失敗を成功扱いしない。
    insert into public.job_publish_checks(id,job_number,farmer_id,items,agreed_at)
      values(p_request_id,v_job.job_number,v_uid,p_items,p_agreed_at);
    v_result := jsonb_build_object('ok',true,'request_id',p_request_id,'check_id',p_request_id,
      'job_id',p_job_id,'job_number',v_job.job_number,'pending',v_job.status='pending','published_base',v_current);
    insert into private.job_publication_requests(id,farmer_id,job_id,request,result)
      values(p_request_id,v_uid,p_job_id,v_request,v_result);
    return v_result || jsonb_build_object('row',to_jsonb(v_job));
  exception when others then
    -- 掲載UPDATE・確認記録・操作台帳をすべて取り消した明確な拒否。
    -- 通信断と区別できるため、利用者は入力を修正して新しい操作を開始できる。
    return jsonb_build_object('ok',false,'reason','publication_rejected','code',sqlstate);
  end;
end $function$;

create function public.publish_my_job_with_check(p_request_id uuid,p_job_id uuid,p_expected jsonb,p_items jsonb,p_agreed_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $$
  select private.publish_job_with_check(p_request_id,p_job_id,p_expected,p_items,p_agreed_at)
$$;
revoke all on function private.publish_job_with_check(uuid,uuid,jsonb,jsonb,timestamptz),
  public.publish_my_job_with_check(uuid,uuid,jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.publish_job_with_check(uuid,uuid,jsonb,jsonb,timestamptz),
  public.publish_my_job_with_check(uuid,uuid,jsonb,jsonb,timestamptz) to authenticated;
-- 古いクライアントへ分離保存を許すフォールバックは設けない。更新後に再試行してもらう。
revoke execute on function public.publish_my_job(integer) from public,anon,authenticated;
commit;
