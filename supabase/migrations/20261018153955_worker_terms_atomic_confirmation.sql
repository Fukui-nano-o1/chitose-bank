-- Worker confirmation and its chat record are one transaction.
begin;
create function private.confirm_worker_terms(p_owner uuid,p_application_id uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $function$
declare
  v_uid uuid:=auth.uid();
  v_app public.applications%rowtype;
  v_message uuid;
begin
  if v_uid is null or p_owner is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  select * into v_app from public.applications where id=p_application_id for update;
  if not found or v_app.worker_id is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_party'); end if;
  if public.is_account_moderated(v_uid) then return jsonb_build_object('ok',false,'reason','moderated'); end if;
  -- Includes confirmations stamped at application creation. Never send an
  -- unsolicited historical message or reset a frozen existing contract.
  if v_app.terms_confirmed_worker_at is not null then
    return jsonb_build_object('ok',true,'owner',v_uid,'application_id',v_app.id,'worker_confirmed',true,
      'farmer_confirmed',v_app.terms_confirmed_farmer_at is not null,'already',true);
  end if;
  -- Same closed-state restriction as the existing message INSERT RLS.
  if v_app.status in ('rejected','expired','canceled','completed') then return jsonb_build_object('ok',false,'reason','closed'); end if;
  update public.applications set terms_confirmed_worker_at=now() where id=v_app.id returning * into v_app;
  if v_app.terms_confirmed_worker_at is null then raise exception 'CONFIRMATION_NOT_SAVED'; end if;
  if v_app.terms_confirmed_farmer_at is not null then
    update public.applications a set terms_snapshot=coalesce(a.terms_snapshot,
      (select to_jsonb(j)-'lat'-'lng' from public.jobs j where j.job_number=v_app.job_number)
      ||jsonb_build_object('snapshot_at',now())) where a.id=v_app.id returning * into v_app;
    if v_app.terms_snapshot is null then raise exception 'TERMS_SNAPSHOT_NOT_SAVED'; end if;
  end if;
  insert into public.messages(application_id,sender_id,body)
    values(v_app.id,v_uid,'✓ 求人内容を確認しました。よろしくお願いします。') returning id into v_message;
  if v_message is null then raise exception 'CONFIRMATION_MESSAGE_NOT_SAVED'; end if;
  return jsonb_build_object('ok',true,'owner',v_uid,'application_id',v_app.id,'worker_confirmed',true,
    'farmer_confirmed',v_app.terms_confirmed_farmer_at is not null,'message_id',v_message,'already',false);
exception when others then
  -- PostgreSQL rolls back the update, snapshot, message and transactional
  -- notification side effects before returning this definite rejection.
  return jsonb_build_object('ok',false,'reason','save_rejected','code',sqlstate);
end $function$;
revoke all on function private.confirm_worker_terms(uuid,uuid) from public,anon,authenticated;
grant execute on function private.confirm_worker_terms(uuid,uuid) to authenticated;
create function public.confirm_my_worker_terms(p_owner uuid,p_application_id uuid)
returns jsonb language sql security invoker set search_path='' as $function$
  select private.confirm_worker_terms(p_owner,p_application_id);
$function$;
revoke all on function public.confirm_my_worker_terms(uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_my_worker_terms(uuid,uuid) to authenticated;
commit;
