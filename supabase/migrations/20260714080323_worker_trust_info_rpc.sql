CREATE OR REPLACE FUNCTION public.worker_trust_info(p_worker_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_joined timestamptz;
  v_verified timestamptz;
begin
  if auth.uid() <> p_worker_id and not exists (
    select 1 from public.applications a
    where a.worker_id = p_worker_id and a.farmer_id = auth.uid()
  ) then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;

  select created_at into v_joined from auth.users where id = p_worker_id;
  select created_at into v_verified from public.account_holders where auth_id = p_worker_id;

  return json_build_object('ok', true, 'joined_at', v_joined, 'verified_at', v_verified);
end;
$function$;