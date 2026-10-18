-- The canonical phone and consignor profile must commit together. Existing RLS remains authoritative.
create function public.save_my_consignor_profile(p_owner uuid,p_expected jsonb,p_type text,p_data jsonb,p_expected_phone text,p_phone text)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare
  v_uid uuid := auth.uid();
  v_profile public.consignment_profiles%rowtype;
  v_account public.account_holders%rowtype;
  v_exists boolean;
  v_data jsonb;
  v_phone text := nullif(btrim(p_phone),'');
  v_result jsonb;
begin
  if v_uid is null or v_uid is distinct from p_owner then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  if p_type is null or p_type not in ('individual','corporate') or jsonb_typeof(p_data) is distinct from 'object'
    or octet_length(p_data::text)>262144 or (p_expected is not null and (jsonb_typeof(p_expected) is distinct from 'object'
    or not p_expected ?& array['consignor_type','consignor_data'] or p_expected - array['consignor_type','consignor_data'] <> '{}'::jsonb)) then
    return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  if p_type <> 'individual' and v_phone is not null then return jsonb_build_object('ok',false,'reason','invalid_phone'); end if;
  v_data := p_data - array['ind_name','ind_birth','ind_zip','ind_addr_main','ind_addr_detail','ind_email','ind_phone',
    'corp_name','corp_no','corp_zip','corp_addr_main','corp_addr_detail','corp_phone','corp_email'];
  perform pg_advisory_xact_lock(hashtextextended('consignor:'||v_uid::text,0));
  select * into v_account from public.account_holders where auth_id=v_uid for update;
  if not found then return jsonb_build_object('ok',false,'reason','registration_missing'); end if;
  select * into v_profile from public.consignment_profiles where auth_id=v_uid for update;
  v_exists := found;
  if v_exists and v_profile.consignor_type=p_type and v_profile.consignor_data=v_data
    and (v_phone is null or v_account.contact_phone=v_phone) then
    return jsonb_build_object('ok',true,'profile',to_jsonb(v_profile),'account',to_jsonb(v_account));
  end if;
  if (v_exists and (p_expected is null or p_expected is distinct from jsonb_build_object('consignor_type',v_profile.consignor_type,'consignor_data',v_profile.consignor_data)))
    or (not v_exists and p_expected is not null) then
    return jsonb_build_object('ok',false,'reason','conflict');
  end if;
  if v_phone is not null and v_account.contact_phone is distinct from v_phone then
    if nullif(btrim(v_account.contact_phone),'') is not null or v_account.contact_phone is distinct from p_expected_phone then
      return jsonb_build_object('ok',false,'reason','phone_conflict');
    end if;
    v_result := public.update_account_holder_self(jsonb_build_object('contact_phone',v_phone),'consignment_flow')::jsonb;
    if not coalesce((v_result->>'ok')::boolean,false) then raise exception 'CONSIGNOR_PHONE_NOT_SAVED'; end if;
    select * into v_account from public.account_holders where auth_id=v_uid;
    if v_account.contact_phone is distinct from v_phone then raise exception 'CONSIGNOR_PHONE_NOT_CONFIRMED'; end if;
  end if;
  if v_exists then
    update public.consignment_profiles set consignor_type=p_type,consignor_data=v_data,updated_at=clock_timestamp()
      where auth_id=v_uid returning * into v_profile;
  else
    insert into public.consignment_profiles(auth_id,consignor_type,consignor_data) values(v_uid,p_type,v_data) returning * into v_profile;
  end if;
  if v_profile.auth_id is null then raise exception 'CONSIGNOR_PROFILE_NOT_SAVED'; end if;
  return jsonb_build_object('ok',true,'profile',to_jsonb(v_profile),'account',to_jsonb(v_account));
end $function$;
revoke all on function public.save_my_consignor_profile(uuid,jsonb,text,jsonb,text,text) from public,anon;
grant execute on function public.save_my_consignor_profile(uuid,jsonb,text,jsonb,text,text) to authenticated;

create function public.save_my_consignor_consent(p_owner uuid,p_version text,p_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare v_uid uuid := auth.uid(); v_row public.consignment_profiles%rowtype;
begin
  if v_uid is null or v_uid is distinct from p_owner then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  if nullif(btrim(p_version),'') is null or length(p_version)>120 or p_at is null or not isfinite(p_at) then
    return jsonb_build_object('ok',false,'reason','invalid_consent');
  end if;
  insert into public.consignment_profiles(auth_id,consignment_data_consent,consignment_data_consent_at,consignment_data_consent_version,consignment_data_consent_user_id)
    values(v_uid,true,p_at,p_version,v_uid)
    on conflict(auth_id) do update set consignment_data_consent=true,consignment_data_consent_at=p_at,
      consignment_data_consent_version=p_version,consignment_data_consent_user_id=v_uid,updated_at=clock_timestamp()
    returning * into v_row;
  if v_row.auth_id is null then raise exception 'CONSIGNOR_CONSENT_NOT_SAVED'; end if;
  return jsonb_build_object('ok',true,'profile',to_jsonb(v_row));
end $function$;
revoke all on function public.save_my_consignor_consent(uuid,text,timestamptz) from public,anon;
grant execute on function public.save_my_consignor_consent(uuid,text,timestamptz) to authenticated;
