CREATE OR REPLACE FUNCTION public.worker_want_again_count(p_worker_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_count int;
begin
  if auth.uid() <> p_worker_id and not exists (
    select 1 from public.applications a
    where a.worker_id = p_worker_id and a.farmer_id = auth.uid()
  ) then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;

  select count(*) into v_count from public.reviews
    where reviewee_id = p_worker_id and direction = 'farmer_to_worker' and want_again = true;

  return json_build_object('ok', true, 'want_again_count', v_count);
end;
$function$;