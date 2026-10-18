CREATE OR REPLACE FUNCTION public.update_account_holder_self(p_patch jsonb, p_source text DEFAULT 'app'::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_allowed text[] := array['full_name','postal_code','address','contact_email',
    'contact_phone','company_name','birth_date'];
  k text; v_n int;
begin
  if auth.uid() is null then return json_build_object('ok',false,'reason','not_authenticated'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return json_build_object('ok',false,'reason','bad_patch');
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any(v_allowed)) then
      return json_build_object('ok',false,'reason','key_not_allowed','key',k);
    end if;
  end loop;
  perform set_config('app.change_source', coalesce(nullif(btrim(p_source),''),'app'), true);
  update public.account_holders set
    full_name     = case when p_patch ? 'full_name'     then p_patch->>'full_name'     else full_name end,
    postal_code   = case when p_patch ? 'postal_code'   then p_patch->>'postal_code'   else postal_code end,
    address       = case when p_patch ? 'address'       then p_patch->>'address'       else address end,
    contact_email = case when p_patch ? 'contact_email' then p_patch->>'contact_email' else contact_email end,
    contact_phone = case when p_patch ? 'contact_phone' then p_patch->>'contact_phone' else contact_phone end,
    company_name  = case when p_patch ? 'company_name'  then p_patch->>'company_name'  else company_name end,
    birth_date    = case when p_patch ? 'birth_date'    then nullif(p_patch->>'birth_date','')::date else birth_date end
  where auth_id = auth.uid();
  get diagnostics v_n = row_count;
  return json_build_object('ok', v_n > 0, 'updated', v_n);
end; $function$;
