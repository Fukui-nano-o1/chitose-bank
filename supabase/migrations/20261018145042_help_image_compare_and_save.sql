-- 公開参照だけを条件付きで変更する。Storage実体の削除はここでは行わない。
begin;
create function public.save_help_image_reference(p_owner uuid,p_slot text,p_expected jsonb,p_url text)
returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $function$
declare
  v_uid uuid := auth.uid();
  v_before public.help_images%rowtype;
  v_after public.help_images%rowtype;
  v_base jsonb;
  v_count integer;
begin
  if v_uid is null or p_owner is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  if not exists(select 1 from public.app_admins where auth_id=v_uid) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if p_slot is null or p_slot !~ '^[a-zA-Z0-9_-]{1,120}$'
    or (p_url is not null and (length(p_url)>2048 or p_url !~ '^https://[^/]+/storage/v1/object/public/help-images/v2/[a-zA-Z0-9_-]+/[0-9a-f-]+\.(jpg|png|webp|gif)$')) then
    return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  if p_expected is not null then
    if jsonb_typeof(p_expected) is distinct from 'object' or not (p_expected ?& array['url','updated_at'])
      or p_expected - array['url','updated_at'] <> '{}'::jsonb or jsonb_typeof(p_expected->'url') is distinct from 'string'
      or p_expected->>'updated_at' is null then return jsonb_build_object('ok',false,'reason','invalid_input'); end if;
    p_expected := p_expected || jsonb_build_object('updated_at',(p_expected->>'updated_at')::timestamptz);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('help-image:'||p_slot,0));
  select * into v_before from public.help_images where slot_key=p_slot for update;
  if found then
    v_base:=jsonb_build_object('url',v_before.url,'updated_at',v_before.updated_at);
    if v_before.url=p_url then return jsonb_build_object('ok',true,'row',to_jsonb(v_before)); end if;
  elsif p_url is null then return jsonb_build_object('ok',true,'row',null);
  end if;
  if v_base is distinct from p_expected then return jsonb_build_object('ok',false,'reason','conflict'); end if;
  if p_url is null then
    delete from public.help_images where slot_key=p_slot;
    get diagnostics v_count=row_count;
    if v_count<>1 then raise exception 'HELP_IMAGE_DELETE_NOT_CONFIRMED'; end if;
    return jsonb_build_object('ok',true,'row',null);
  elsif v_before.slot_key is null then
    insert into public.help_images(slot_key,url) values(p_slot,p_url) returning * into v_after;
  else
    update public.help_images set url=p_url,updated_at=greatest(now(),v_before.updated_at+interval '1 microsecond') where slot_key=p_slot returning * into v_after;
  end if;
  if v_after.slot_key is distinct from p_slot or v_after.url is distinct from p_url then raise exception 'HELP_IMAGE_SAVE_NOT_CONFIRMED'; end if;
  return jsonb_build_object('ok',true,'row',to_jsonb(v_after));
end $function$;
revoke all on function public.save_help_image_reference(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_help_image_reference(uuid,text,jsonb,text) to authenticated;
commit;
