-- Read-only production function; no user records.
CREATE OR REPLACE FUNCTION public.job_details_for_party(p_job_numbers integer[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- same shape as a logged-in jobs_public row, built with to_jsonb(j) so new jobs
  -- columns follow automatically. Only the 5 derived fields are spelled out.
  select coalesce(jsonb_agg(x.row_json), '[]'::jsonb)
  from (
    select (to_jsonb(j)
             - 'id' - 'farmer_id' - 'address' - 'zip' - 'draft_step'
             - 'geocoded_from' - 'unlisted_at' - 'unlisted_reason' - 'revision_requested_at')
           || jsonb_build_object(
                'work_address', case when private.can_read_meeting_address(j.job_number) then j.address else null::text end,
                'has_work_address', (j.address is not null and btrim(j.address) <> ''),
                'employer_nickname', ep.nickname,
                'employer_avatar_url', ep.avatar_url,
                'hired_count', (select count(*) from public.applications a
                                 where a.job_number = j.job_number
                                   and a.terms_confirmed_worker_at is not null
                                   and a.terms_confirmed_farmer_at is not null),
                'masked_fields', '[]'::jsonb) as row_json
      from public.jobs j
      left join public.employer_profiles ep on ep.auth_id = j.farmer_id
     where j.job_number = any (p_job_numbers[1:100])
       and auth.uid() is not null and public.is_job_party(j.job_number)
  ) x;
$function$
;
