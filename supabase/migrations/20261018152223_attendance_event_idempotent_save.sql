-- One event UUID identifies one immutable attendance report and its notification triggers.
begin;
create function public.record_my_attendance_once(p_owner uuid,p_event_id uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $function$
declare
  v_uid uuid:=auth.uid();
  v_input jsonb;
  v_previous jsonb;
  v_row public.attendance_events%rowtype;
begin
  if v_uid is null or p_owner is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  if p_event_id is null or jsonb_typeof(p_input) is distinct from 'object'
    or not (p_input ?& array['application_id','kind'])
    or p_input - array['application_id','kind','reason','work_date','detail'] <> '{}'::jsonb
    or jsonb_typeof(p_input->'application_id') is distinct from 'string'
    or jsonb_typeof(p_input->'kind') is distinct from 'string' or octet_length(p_input::text)>65536
    or exists(select 1 from jsonb_each(p_input) where key in ('reason','detail','work_date') and value<>'null'::jsonb and jsonb_typeof(value)<>'string') then
    return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  v_input:=jsonb_build_object('application_id',(p_input->>'application_id')::uuid,'kind',p_input->>'kind',
    'reason',p_input->>'reason','work_date',(p_input->>'work_date')::date,'detail',p_input->>'detail');
  perform pg_advisory_xact_lock(hashtextextended('attendance:'||p_event_id::text,0));
  select * into v_row from public.attendance_events where id=p_event_id;
  if found then
    select jsonb_object_agg(key,value) into v_previous from jsonb_each(to_jsonb(v_row)) where key=any(array['application_id','kind','reason','work_date','detail']);
    if v_row.actor_id is distinct from v_uid or v_previous is distinct from v_input then return jsonb_build_object('ok',false,'reason','request_mismatch'); end if;
    return jsonb_build_object('ok',true,'row',to_jsonb(v_row),'replayed',true);
  end if;
  begin
    insert into public.attendance_events(id,application_id,actor_id,kind,reason,work_date,detail)
      values(p_event_id,(v_input->>'application_id')::uuid,v_uid,v_input->>'kind',v_input->>'reason',(v_input->>'work_date')::date,v_input->>'detail')
      returning * into v_row;
    if v_row.id is null then raise exception 'ATTENDANCE_NOT_SAVED'; end if;
    return jsonb_build_object('ok',true,'row',to_jsonb(v_row),'replayed',false);
  exception when unique_violation then
    -- Another permitted insertion path may not take this advisory lock.
    select * into v_row from public.attendance_events where id=p_event_id and actor_id=v_uid;
    select jsonb_object_agg(key,value) into v_previous from jsonb_each(to_jsonb(v_row)) where key=any(array['application_id','kind','reason','work_date','detail']);
    if v_row.id is not null and v_previous=v_input then return jsonb_build_object('ok',true,'row',to_jsonb(v_row),'replayed',true); end if;
    return jsonb_build_object('ok',false,'reason','request_mismatch');
  when others then
    return jsonb_build_object('ok',false,'reason','save_rejected','code',sqlstate);
  end;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
  return jsonb_build_object('ok',false,'reason','invalid_input');
end $function$;
revoke all on function public.record_my_attendance_once(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_my_attendance_once(uuid,uuid,jsonb) to authenticated;
commit;
