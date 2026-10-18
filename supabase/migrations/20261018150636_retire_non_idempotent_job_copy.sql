-- Apply after the new copy_my_job_once frontend is serving production.
-- The private definer still calls the existing copy implementation internally.
revoke all on function public.copy_job(integer) from public,anon,authenticated;
