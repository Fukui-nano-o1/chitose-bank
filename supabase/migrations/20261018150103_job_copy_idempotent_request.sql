begin;
create schema if not exists private;
create table private.job_copy_requests (
  id uuid primary key,
  actor_id uuid not null,
  source_number integer not null,
  target_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.job_copy_requests enable row level security;
revoke all on private.job_copy_requests from public,anon,authenticated;

create function private.copy_job_once(p_owner uuid,p_request_id uuid,p_job_number integer)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $function$
declare
  v_uid uuid:=auth.uid();
  v_previous private.job_copy_requests%rowtype;
  v_job public.jobs%rowtype;
  v_result jsonb;
begin
  if v_uid is null or p_owner is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  if p_request_id is null or p_job_number is null then return jsonb_build_object('ok',false,'reason','invalid_input'); end if;
  perform pg_advisory_xact_lock(hashtextextended('job-copy:'||p_request_id::text,0));
  select * into v_previous from private.job_copy_requests where id=p_request_id;
  if found then
    if v_previous.actor_id is distinct from v_uid or v_previous.source_number is distinct from p_job_number then
      return jsonb_build_object('ok',false,'reason','request_mismatch');
    end if;
    select * into v_job from public.jobs where id=v_previous.target_id and farmer_id=v_uid;
    if not found then return jsonb_build_object('ok',false,'reason','copy_deleted','request_id',p_request_id); end if;
    return v_previous.result || jsonb_build_object('job',to_jsonb(v_job),'replayed',true,
      'copy_unchanged',to_jsonb(v_job) is not distinct from v_previous.result->'job');
  end if;
  begin
    -- Existing copy policy, validation and triggers remain the only implementation.
    v_result:=public.copy_job(p_job_number)::jsonb;
    if not coalesce((v_result->>'ok')::boolean,false) then return v_result; end if;
    select * into v_job from public.jobs where id=(v_result->'job'->>'id')::uuid and farmer_id=v_uid;
    if not found then raise exception 'COPY_NOT_CONFIRMED'; end if;
    v_result:=v_result||jsonb_build_object('request_id',p_request_id,'owner',v_uid,'replayed',false,'copy_unchanged',true);
    insert into private.job_copy_requests(id,actor_id,source_number,target_id,result)
      values(p_request_id,v_uid,p_job_number,v_job.id,v_result);
    return v_result;
  exception when others then
    return jsonb_build_object('ok',false,'reason','copy_rejected','code',sqlstate);
  end;
end $function$;
create function public.copy_my_job_once(p_owner uuid,p_request_id uuid,p_job_number integer)
returns jsonb language sql security invoker set search_path='' as $$
  select private.copy_job_once(p_owner,p_request_id,p_job_number)
$$;
revoke all on function private.copy_job_once(uuid,uuid,integer),public.copy_my_job_once(uuid,uuid,integer) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.copy_job_once(uuid,uuid,integer),public.copy_my_job_once(uuid,uuid,integer) to authenticated;
commit;
