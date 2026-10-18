-- Focused writes for the remaining admin-only consignment inputs.
-- Existing table RLS and contract snapshot triggers continue to apply.
begin;
create function public.save_my_consignment_aux(p_owner uuid,p_operation text,p_id uuid,p_expected jsonb,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $function$
declare
  v_uid uuid:=auth.uid();
  v_field public.consignment_fields%rowtype;
  v_profile public.consignment_profiles%rowtype;
  v_deal public.consignment_deals%rowtype;
  v_progress public.consignment_progress%rowtype;
  v_row jsonb;
  v_base jsonb;
  v_action text;
  v_from text;
  v_to text;
  v_date date;
  v_found boolean;
begin
  if v_uid is null or p_owner is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  if not exists(select 1 from public.app_admins where auth_id=v_uid) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if p_id is null or p_operation is null or p_operation not in ('field_save','field_delete','lend','terms','advance','progress')
    or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>262144 then
    return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('consignment-aux:'||p_id::text,0));
  if p_operation in ('field_save','field_delete') then
    select * into v_field from public.consignment_fields where id=p_id for update;
    v_found:=found;
    if v_found and v_field.auth_id is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_owner'); end if;
    v_base:=case when v_found then jsonb_build_object('name',v_field.name,'region',v_field.region,'area_a',v_field.area_a,'data',v_field.data,'updated_at',v_field.updated_at) else null end;
    if p_expected is not null then p_expected:=p_expected||jsonb_build_object('updated_at',(p_expected->>'updated_at')::timestamptz); end if;
    if p_operation='field_delete' then
      if p_input<>'{}'::jsonb then return jsonb_build_object('ok',false,'reason','invalid_input'); end if;
      if v_found and v_base is distinct from p_expected then return jsonb_build_object('ok',false,'reason','conflict'); end if;
      if v_found then delete from public.consignment_fields where id=p_id returning * into v_field; if not found then raise exception 'FIELD_DELETE_NOT_SAVED'; end if; end if;
      v_row:='null'::jsonb;
    else
      if not(p_input ?& array['name','region','area_a','data']) or p_input-array['name','region','area_a','data']<>'{}'::jsonb
        or exists(select 1 from jsonb_each(p_input-array['data']) where jsonb_typeof(value) is distinct from 'string')
        or nullif(btrim(p_input->>'name'),'') is null or jsonb_typeof(p_input->'data') is distinct from 'object' then
        return jsonb_build_object('ok',false,'reason','invalid_input');
      end if;
      if not(v_found and v_base-'updated_at'=p_input) then
        if v_base is distinct from p_expected then return jsonb_build_object('ok',false,'reason','conflict'); end if;
        if v_found then
          update public.consignment_fields set name=p_input->>'name',region=p_input->>'region',area_a=p_input->>'area_a',data=p_input->'data',updated_at=clock_timestamp()
            where id=p_id and auth_id=v_uid returning * into v_field;
        else
          insert into public.consignment_fields(id,auth_id,name,region,area_a,data) values(p_id,v_uid,p_input->>'name',p_input->>'region',p_input->>'area_a',p_input->'data') returning * into v_field;
        end if;
        if v_field.id is null then raise exception 'FIELD_NOT_SAVED'; end if;
      end if;
      v_row:=to_jsonb(v_field);
    end if;
  elsif p_operation in ('lend','terms') then
    if p_id is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_owner'); end if;
    -- The existing consignor/profile writers also lock this owner or row.
    perform pg_advisory_xact_lock(hashtextextended('consignor:'||v_uid::text,0));
    select * into v_profile from public.consignment_profiles where auth_id=v_uid for update;
    v_found:=found;
    if p_operation='lend' then
      if p_input - 'items'<>'{}'::jsonb or jsonb_typeof(p_input->'items') is distinct from 'array'
        or jsonb_array_length(p_input->'items')>500 or exists(select 1 from jsonb_array_elements(p_input->'items') x
        where jsonb_typeof(x)<>'object' or x-array['k','n']<>'{}'::jsonb or jsonb_typeof(x->'k') is distinct from 'string' or jsonb_typeof(x->'n') is distinct from 'string' or nullif(btrim(x->>'n'),'') is null) then
        return jsonb_build_object('ok',false,'reason','invalid_input');
      end if;
      if coalesce(v_profile.consignor_data->'cmn_lend_items','null'::jsonb) is distinct from p_input->'items' then
        if coalesce(v_profile.consignor_data->'cmn_lend_items','null'::jsonb) is distinct from coalesce(p_expected,'null'::jsonb) then return jsonb_build_object('ok',false,'reason','conflict'); end if;
        if v_found then update public.consignment_profiles set consignor_data=jsonb_set(consignor_data,'{cmn_lend_items}',p_input->'items'),updated_at=clock_timestamp() where auth_id=v_uid returning * into v_profile;
        else insert into public.consignment_profiles(auth_id,consignor_data) values(v_uid,jsonb_build_object('cmn_lend_items',p_input->'items')) returning * into v_profile; end if;
      end if;
    else
      if p_input is distinct from jsonb_build_object('version','consignment-terms-v1-2026-08') then return jsonb_build_object('ok',false,'reason','invalid_input'); end if;
      if not coalesce(v_profile.consignment_terms_consent and v_profile.consignment_terms_consent_version=p_input->>'version',false) then
        insert into public.consignment_profiles(auth_id,consignment_terms_consent,consignment_terms_consent_at,consignment_terms_consent_version,consignment_terms_consent_user_id)
        values(v_uid,true,clock_timestamp(),p_input->>'version',v_uid) on conflict(auth_id) do update set consignment_terms_consent=true,
          consignment_terms_consent_at=excluded.consignment_terms_consent_at,consignment_terms_consent_version=excluded.consignment_terms_consent_version,
          consignment_terms_consent_user_id=v_uid,updated_at=clock_timestamp() returning * into v_profile;
      end if;
    end if;
    if v_profile.auth_id is null then raise exception 'PROFILE_NOT_SAVED'; end if;
    v_row:=to_jsonb(v_profile);
  elsif p_operation='progress' then
    if not(p_input ?& array['deal_id','work_date','hours','workers','yield_boxes','note']) or p_input-array['deal_id','work_date','hours','workers','yield_boxes','note']<>'{}'::jsonb
      or jsonb_typeof(p_input->'note') is distinct from 'string' or p_input->>'work_date' is null or not isfinite((p_input->>'work_date')::date)
      or exists(select 1 from jsonb_each(p_input) where key in ('hours','workers','yield_boxes') and value<>'null'::jsonb and (jsonb_typeof(value)<>'number' or (value::text)::numeric<0))
      or (p_input->>'workers')::numeric is distinct from trunc((p_input->>'workers')::numeric)
      or (p_input->>'yield_boxes')::numeric is distinct from trunc((p_input->>'yield_boxes')::numeric) then
      return jsonb_build_object('ok',false,'reason','invalid_input');
    end if;
    select * into v_deal from public.consignment_deals where id=(p_input->>'deal_id')::uuid for update;
    if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
    select * into v_progress from public.consignment_progress where id=p_id;
    v_found:=found;
    if not v_found then
      insert into public.consignment_progress(id,deal_id,work_date,hours,workers,yield_boxes,note) values(p_id,v_deal.id,(p_input->>'work_date')::date,
        (p_input->>'hours')::numeric,(p_input->>'workers')::integer,(p_input->>'yield_boxes')::integer,p_input->>'note') returning * into v_progress;
      if v_progress.id is null then raise exception 'PROGRESS_NOT_SAVED'; end if;
    end if;
    if to_jsonb(v_progress)-array['id','created_at'] is distinct from p_input then
      if not v_found then raise exception 'PROGRESS_NOT_CONFIRMED'; end if;
      return jsonb_build_object('ok',false,'reason','conflict');
    end if;
    v_row:=to_jsonb(v_progress);
  else
    if not(p_input ?& array['action','date','note']) or p_input-array['action','date','note']<>'{}'::jsonb
      or jsonb_typeof(p_input->'note') is distinct from 'string' then return jsonb_build_object('ok',false,'reason','invalid_input'); end if;
    v_action:=p_input->>'action';v_date:=(p_input->>'date')::date;
    if v_action is null or v_action not in ('agree','deposit','start','inspect','pay','complete') or v_date is null or not isfinite(v_date) then return jsonb_build_object('ok',false,'reason','invalid_input'); end if;
    select * into v_deal from public.consignment_deals where id=p_id for update;
    if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
    v_from:=case v_action when 'agree' then 'draft' when 'deposit' then 'agreed' when 'start' then 'agreed' when 'inspect' then 'working' when 'pay' then 'inspected' when 'complete' then 'paid' end;
    v_to:=case v_action when 'agree' then 'agreed' when 'deposit' then 'agreed' when 'start' then 'working' when 'inspect' then 'inspected' when 'pay' then 'paid' when 'complete' then 'done' end;
    if not coalesce(v_deal.status=v_to and case v_action when 'deposit' then v_deal.spec->>'deposit_received_at'=v_date::text
      when 'inspect' then v_deal.inspected_at=v_date and coalesce(v_deal.notes,'')=p_input->>'note'
      when 'pay' then v_deal.paid_at=v_date when 'complete' then v_deal.spec->>'reflection'=p_input->>'note' else true end,false) then
      if v_deal.status is distinct from v_from or v_deal.updated_at is distinct from (p_expected->>'updated_at')::timestamptz then return jsonb_build_object('ok',false,'reason','conflict'); end if;
      update public.consignment_deals set status=v_to,
        spec=case v_action when 'deposit' then jsonb_set(spec,'{deposit_received_at}',to_jsonb(v_date::text)) when 'complete' then jsonb_set(spec,'{reflection}',p_input->'note') else spec end,
        inspected_at=case when v_action='inspect' then v_date else inspected_at end,
        paid_at=case when v_action='pay' then v_date else paid_at end,
        notes=case when v_action='inspect' then nullif(p_input->>'note','') else notes end
        where id=p_id returning * into v_deal;
      if v_deal.id is null then raise exception 'DEAL_NOT_SAVED'; end if;
    end if;
    v_row:=to_jsonb(v_deal);
  end if;
  return jsonb_build_object('ok',true,'owner',v_uid,'operation',p_operation,'id',p_id,'input',p_input,'row',v_row);
exception when others then
  return jsonb_build_object('ok',false,'reason','save_rejected','code',sqlstate);
end $function$;
revoke all on function public.save_my_consignment_aux(uuid,text,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_my_consignment_aux(uuid,text,uuid,jsonb,jsonb) to authenticated;
commit;
