-- 案件・圃場登録簿・初回標準条件・再送台帳を同じトランザクションで確定する。
-- 既存の管理者限定と、圃場の正式住所・設備、標準条件の既存値を守る。
begin;
create schema if not exists private;
create table private.consignment_save_requests (
  id uuid primary key,
  actor_id uuid not null,
  deal_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.consignment_save_requests enable row level security;
revoke all on private.consignment_save_requests from public,anon,authenticated;

create function private.save_consignment_bundle(p_owner uuid,p_request_id uuid,p_deal_id uuid,
  p_expected jsonb,p_patch jsonb,p_expected_field jsonb,p_terms jsonb)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $function$
declare
  v_uid uuid := auth.uid();
  v_deal public.consignment_deals%rowtype;
  v_field public.consignment_fields%rowtype;
  v_profile public.consignment_profiles%rowtype;
  v_previous private.consignment_save_requests%rowtype;
  v_request jsonb;
  v_result jsonb;
  v_base jsonb;
  v_data jsonb;
  v_name text;
  v_area text;
  v_key text;
  v_value text;
  v_found boolean;
begin
  if v_uid is null or p_owner is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  if not exists(select 1 from public.app_admins where auth_id=v_uid) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if p_request_id is null or p_deal_id is null
    or jsonb_typeof(p_patch) is distinct from 'object' or jsonb_typeof(p_terms) is distinct from 'object'
    or jsonb_typeof(p_patch->'spec') is distinct from 'object'
    or jsonb_typeof(p_patch->'status') is distinct from 'string'
    or p_patch->>'status' not in ('draft','agreed','working','inspected','paid','done')
    or not (p_patch ?& array['spec','status','notes']) or p_patch - array['spec','status','notes'] <> '{}'::jsonb
    or (p_patch->'notes' <> 'null'::jsonb and jsonb_typeof(p_patch->'notes') is distinct from 'string')
    or octet_length(p_patch::text)>524288 or octet_length(p_terms::text)>32768
    or p_terms - array['cmn_pay_due','cmn_fee_bearer','cmn_inspect','cmn_cancel'] <> '{}'::jsonb
    or exists(select 1 from jsonb_each(p_terms) where jsonb_typeof(value) is distinct from 'string') then
    return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  if p_expected is not null and (jsonb_typeof(p_expected) is distinct from 'object'
    or not (p_expected ?& array['spec','status','notes','updated_at'])
    or p_expected - array['spec','status','notes','updated_at'] <> '{}'::jsonb) then
    return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  if p_expected_field is not null and (jsonb_typeof(p_expected_field) is distinct from 'object'
    or jsonb_typeof(p_expected_field->'area_a') is distinct from 'string'
    or p_expected_field - 'area_a' <> '{}'::jsonb) then
    return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  if jsonb_typeof(p_patch->'spec'->'photos') is distinct from 'array' then
    return jsonb_build_object('ok',false,'reason','photos_required');
  end if;
  if jsonb_array_length(p_patch->'spec'->'photos')<3 then return jsonb_build_object('ok',false,'reason','photos_required'); end if;
  -- 日時の表記差を正規化。無効日時も変更前に拒否される。
  if p_expected is not null then
    if p_expected->>'updated_at' is null or not isfinite((p_expected->>'updated_at')::timestamptz) then
      return jsonb_build_object('ok',false,'reason','invalid_input');
    end if;
    p_expected := p_expected || jsonb_build_object('updated_at',(p_expected->>'updated_at')::timestamptz);
  end if;
  v_request := jsonb_build_object('deal_id',p_deal_id,'expected',p_expected,'patch',p_patch,'field',p_expected_field,'terms',p_terms);
  perform pg_advisory_xact_lock(hashtextextended('consignment-save:'||p_request_id::text,0));
  select * into v_previous from private.consignment_save_requests where id=p_request_id;
  if found then
    if v_previous.actor_id is distinct from v_uid or v_previous.request is distinct from v_request then
      return jsonb_build_object('ok',false,'reason','request_mismatch');
    end if;
    -- 当時確定した行を返す。他の端末の後続変更を再保存・取り込みしない。
    return v_previous.result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('consignment-deal:'||p_deal_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('consignor:'||v_uid::text,0));
  select * into v_deal from public.consignment_deals where id=p_deal_id for update;
  v_found := found;
  if v_found then
    v_base := jsonb_build_object('spec',v_deal.spec,'status',v_deal.status,'notes',v_deal.notes,'updated_at',v_deal.updated_at);
    if v_base is distinct from p_expected then return jsonb_build_object('ok',false,'reason','conflict'); end if;
  elsif p_expected is not null then return jsonb_build_object('ok',false,'reason','not_found');
  elsif p_patch->>'status' <> 'draft' then return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  v_name := btrim(coalesce(p_patch->'spec'->>'field_name',''));
  v_area := btrim(coalesce(p_patch->'spec'->>'area_a',''));
  if v_name<>'' then
    select * into v_field from public.consignment_fields where auth_id=v_uid and name=v_name for update;
    if found then
      if v_field.area_a is distinct from v_area and jsonb_build_object('area_a',v_field.area_a) is distinct from p_expected_field then
        return jsonb_build_object('ok',false,'reason','field_conflict');
      end if;
    elsif p_expected_field is not null then return jsonb_build_object('ok',false,'reason','field_conflict'); end if;
  end if;
  select * into v_profile from public.consignment_profiles where auth_id=v_uid for update;
  v_data := coalesce(v_profile.consignor_data,'{}'::jsonb);
  for v_key,v_value in select key,btrim(value #>> '{}') from jsonb_each(p_terms) loop
    if v_value<>'' then
      if btrim(coalesce(v_data->>v_key,''))<>'' and btrim(v_data->>v_key)<>v_value then
        return jsonb_build_object('ok',false,'reason','terms_conflict');
      end if;
      if btrim(coalesce(v_data->>v_key,''))='' then v_data:=jsonb_set(v_data,array[v_key],to_jsonb(v_value)); end if;
    end if;
  end loop;
  begin
    if v_found then
      update public.consignment_deals set spec=p_patch->'spec',status=p_patch->>'status',notes=p_patch->>'notes',updated_at=now()
        where id=p_deal_id returning * into v_deal;
    else
      insert into public.consignment_deals(id,spec,status,notes)
        values(p_deal_id,p_patch->'spec',p_patch->>'status',p_patch->>'notes') returning * into v_deal;
    end if;
    if v_deal.id is null then raise exception 'DEAL_NOT_SAVED'; end if;
    if v_name<>'' then
      if v_field.id is null then
        insert into public.consignment_fields(auth_id,name,region,area_a)
          values(v_uid,v_name,btrim(coalesce(p_patch->'spec'->>'region','')),v_area) returning * into v_field;
      else
        update public.consignment_fields set area_a=v_area,updated_at=now() where id=v_field.id returning * into v_field;
      end if;
      if v_field.id is null then raise exception 'FIELD_NOT_SAVED'; end if;
    end if;
    if v_data is distinct from coalesce(v_profile.consignor_data,'{}'::jsonb) then
      insert into public.consignment_profiles(auth_id,consignor_data) values(v_uid,v_data)
        on conflict(auth_id) do update set consignor_data=excluded.consignor_data,updated_at=now() returning * into v_profile;
      if v_profile.auth_id is null then raise exception 'TERMS_NOT_SAVED'; end if;
    end if;
    v_result:=jsonb_build_object('ok',true,'request_id',p_request_id,'owner',v_uid,'row',to_jsonb(v_deal),
      'field',case when v_field.id is null then null else to_jsonb(v_field) end,
      'profile',case when v_profile.auth_id is null then null else to_jsonb(v_profile) end);
    insert into private.consignment_save_requests(id,actor_id,deal_id,request,result) values(p_request_id,v_uid,p_deal_id,v_request,v_result);
    return v_result;
  exception when others then
    return jsonb_build_object('ok',false,'reason','save_rejected','code',sqlstate);
  end;
end $function$;

create function public.save_my_consignment_bundle(p_owner uuid,p_request_id uuid,p_deal_id uuid,
  p_expected jsonb,p_patch jsonb,p_expected_field jsonb,p_terms jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.save_consignment_bundle(p_owner,p_request_id,p_deal_id,p_expected,p_patch,p_expected_field,p_terms)
$$;
revoke all on function private.save_consignment_bundle(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb),
  public.save_my_consignment_bundle(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.save_consignment_bundle(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb),
  public.save_my_consignment_bundle(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb) to authenticated;
commit;
