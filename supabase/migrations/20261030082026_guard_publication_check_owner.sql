-- Narrow only the existing publication-check INSERT ownership predicate.
-- No job publication, data rewrite, grants, triggers, or RPC definitions change.
begin;
set local search_path = pg_catalog, public;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.job_publish_checks in share row exclusive mode;
do $preflight$
declare v_fingerprint text;
begin
  select md5(jsonb_agg(jsonb_build_array(policyname,permissive,roles,cmd,qual,with_check)
    order by policyname)::text) into v_fingerprint
  from pg_policies where schemaname='public' and tablename='job_publish_checks';
  if v_fingerprint is distinct from 'ffecd09f50c582295385658b9249598a' then
    raise exception 'PUBLICATION_CHECK_POLICY_DRIFT';
  end if;
end
$preflight$;

alter policy "jpc owner insert" on public.job_publish_checks
  with check (
    farmer_id = auth.uid()
    and exists (
      select 1 from public.jobs j
      where j.job_number = public.job_publish_checks.job_number
        and j.farmer_id = auth.uid()
    )
  );
commit;
