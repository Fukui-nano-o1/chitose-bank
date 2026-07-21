DROP FUNCTION IF EXISTS public.job_employer_profile(integer);

CREATE FUNCTION public.job_employer_profile(p_job_number integer)
RETURNS TABLE(
  nickname text, pr text, avatar_url text,
  has_transport boolean, transport_area text,
  has_parking boolean, parking_capacity integer,
  has_commute_allowance boolean, commute_allowance_detail text,
  has_bonus boolean, employer_pays_supplies boolean, accessory_ok boolean,
  intro_path text, intro_joy text, intro_crops text, intro_atmosphere text, intro_message text,
  owner_comment text,
  unique_point text, always_do text, break_style text, interaction_style text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select ep.nickname, ep.pr, ep.avatar_url,
         ep.has_transport, ep.transport_area,
         ep.has_parking, ep.parking_capacity,
         ep.has_commute_allowance, ep.commute_allowance_detail,
         ep.has_bonus,
         ep.employer_pays_supplies,
         ep.accessory_ok,
         ep.intro_path, ep.intro_joy, ep.intro_crops,
         ep.intro_atmosphere, ep.intro_message, ep.owner_comment,
         ep.unique_point, ep.always_do, ep.break_style, ep.interaction_style
  from jobs j
  join employer_profiles ep on ep.auth_id = j.farmer_id
  where j.job_number = p_job_number and j.status = 'open';
$function$;

GRANT EXECUTE ON FUNCTION public.job_employer_profile(integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.job_employer_trust_info(p_job_number integer)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_farmer_id uuid;
begin
  select j.farmer_id into v_farmer_id from public.jobs j where j.job_number = p_job_number and j.status = 'open';
  if v_farmer_id is null then return json_build_object('ok', false); end if;
  return public.employer_trust_info(v_farmer_id);
end; $function$;

GRANT EXECUTE ON FUNCTION public.job_employer_trust_info(integer) TO anon, authenticated, service_role;
