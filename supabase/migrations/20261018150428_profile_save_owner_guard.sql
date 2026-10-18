-- Require the account that was displayed when editing; session changes in flight cannot retarget the write.
-- The owner-less overload is retired, so older clients must reload.
begin;
-- Additive owner-only entry point. Existing RLS and validation/publication triggers remain in force.
create function public.save_my_profile_fields(p_table text, p_expected jsonb, p_patch jsonb, p_owner uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_allowed text[];
  v_columns text;
  v_values text;
  v_set text;
  v_row jsonb;
begin
  if v_uid is null or p_owner is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  if p_table = 'worker_profiles' then
    v_allowed := array['nickname','residence_city','transport','farm_experience','physical_level','work_mood','learning_pref','work_pattern','interests','languages','self_declared','experience_entries','experienced_tasks','pr','pr_qa','pr_pending','pr_qa_pending'];
  elsif p_table in ('employer_profiles','consignment_profiles') then
    v_allowed := array['nickname','recruiter_name','recruiter_name_kana','recruiter_address','recruiter_zip','recruiter_prefecture','recruiter_city','recruiter_address_detail','recruiter_contact','consultation_contact','labor_insurance_status','has_transport','has_parking','has_commute_allowance','has_bonus','has_raise','has_severance_pay','employer_pays_supplies','accessory_ok','parking_capacity','smoking_policy','smoking_area','interaction_style','teaching_style','chat_style','question_style','owner_comment','intro_path','intro_joy','intro_crops','intro_atmosphere','intro_message','unique_point','always_do','break_style','transport_area','commute_allowance_detail','supplies_cap','raise_detail','bonus_detail','severance_detail','texts_pending','insurance_items','insurance_notes'];
  elsif p_table = 'emergency_contacts' then
    v_allowed := array['name','relation','phone','confirmed_at'];
  else return jsonb_build_object('ok',false,'reason','invalid_table');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or octet_length(p_patch::text) > 262144 then
    return jsonb_build_object('ok',false,'reason','invalid_patch');
  end if;
  if p_expected is not null and (jsonb_typeof(p_expected) <> 'object' or p_expected = '{}'::jsonb or octet_length(p_expected::text) > 262144) then
    return jsonb_build_object('ok',false,'reason','invalid_expected');
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where not k = any(v_allowed))
     or (p_expected is not null and exists (select 1 from jsonb_object_keys(p_expected) k where not k = any(v_allowed)))
     or (p_expected is not null and exists (select 1 from jsonb_object_keys(p_patch) k where not p_expected ? k)) then
    return jsonb_build_object('ok',false,'reason','invalid_fields');
  end if;
  -- Identifiers come only from the table/column allowlists; all values are bound parameters.
  select string_agg(format('%I',k),',' order by k),
         string_agg(format('r.%I',k),',' order by k),
         string_agg(format('%I = r.%I',k,k),',' order by k)
    into v_columns,v_values,v_set from jsonb_object_keys(p_patch) k;
  if p_expected is null then
    begin
      execute format('insert into public.%I (auth_id,updated_at,%s) select $2,clock_timestamp(),%s from jsonb_populate_record(null::public.%I,$1) r returning to_jsonb(%I.*)',p_table,v_columns,v_values,p_table,p_table)
        into v_row using p_patch,v_uid;
    exception when unique_violation then
      return jsonb_build_object('ok',false,'reason','conflict');
    end;
  else
    execute format('update public.%I t set %s,updated_at=clock_timestamp() from jsonb_populate_record(null::public.%I,$1) r where t.auth_id=$2 and not exists (select 1 from jsonb_each($3) e where (to_jsonb(t)->e.key) is distinct from e.value) returning to_jsonb(t)',p_table,v_set,p_table)
      into v_row using p_patch,v_uid,p_expected;
  end if;
  if v_row is null then return jsonb_build_object('ok',false,'reason','conflict'); end if;
  return jsonb_build_object('ok',true,'row',v_row);
end;
$function$;
revoke all on function public.save_my_profile_fields(text,jsonb,jsonb,uuid) from public,anon;
grant execute on function public.save_my_profile_fields(text,jsonb,jsonb,uuid) to authenticated;

revoke all on function public.save_my_profile_fields(text,jsonb,jsonb) from public,anon,authenticated;
commit;
