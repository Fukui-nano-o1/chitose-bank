CREATE OR REPLACE FUNCTION public.job_employer_profile(p_job_number int)
RETURNS TABLE(nickname text, pr text, avatar_url text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT ep.nickname, ep.pr, ep.avatar_url
  FROM jobs j
  JOIN employer_profiles ep ON ep.auth_id = j.farmer_id
  WHERE j.job_number = p_job_number AND j.status = 'open';
$$;