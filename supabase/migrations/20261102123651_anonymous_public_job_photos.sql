-- Fail closed on catalog drift; run this single migration atomically.
begin;
set local search_path = public;
lock table storage.objects in access exclusive mode;
lock table storage.buckets in share mode;
do $guard$
begin
  if md5(pg_get_functiondef('private.can_read_listing_photo(text,text,text)'::regprocedure))
      is distinct from 'ff9a40b7f9e7be23ed3f091ff3af1f27'
    or not exists (select 1 from pg_proc where oid='private.can_read_listing_photo(text,text,text)'::regprocedure
      and pg_get_userbyid(proowner)='postgres'
      and proacl::text='{postgres=X/postgres,authenticated=X/postgres}') then
    raise exception 'PHOTO_PREFLIGHT: helper definition or privileges drifted';
  end if;
  -- Fingerprint every SELECT/ALL policy, including unrelated-bucket policies:
  -- a newly broadened OR policy could otherwise bypass the intended boundary.
  if (select md5(jsonb_agg(jsonb_build_object('name',policyname,'roles',roles,
      'cmd',cmd,'permissive',permissive,'qual',qual,'check',with_check)
      order by policyname)::text) from pg_policies
      where schemaname='storage' and tablename='objects' and cmd in ('SELECT','ALL'))
      is distinct from '87f13a7ec4e7cacabbbf3d7a554fdf8a'
    or not exists (select 1 from pg_class where oid='storage.objects'::regclass and relrowsecurity) then
    raise exception 'PHOTO_PREFLIGHT: storage read policies or RLS drifted';
  end if;
  if (select count(*) from storage.buckets
      where id in ('job-photos','consignment-photos') and public=false) <> 2 then
    raise exception 'PHOTO_PREFLIGHT: listing buckets must remain private';
  end if;
end;
$guard$;

-- Anonymous visitors may download only photos attached to publicly listed jobs.
-- Keep private buckets, ownership/reference checks, and operation restrictions.
-- NULL auth.uid() cannot match the existing admin/owner/party exceptions.
-- No jobs SELECT grant, upload permission, signed URL, or bucket listing is added.
create or replace function private.can_read_listing_photo(p_bucket text, p_name text, p_owner text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_url text;
begin
  if p_bucket not in ('job-photos','consignment-photos') then return false; end if;
  if exists (select 1 from public.app_admins a where a.auth_id = v_uid) then return true; end if;
  if p_owner = v_uid::text then return true; end if;
  if exists (select 1 from private.listing_photo_legacy_access l
    where l.bucket_id=p_bucket and l.object_name=p_name and l.farmer_id=v_uid) then return true; end if;

  -- Consignment records are administrator-only today. Do not invent a public
  -- photo permission for those otherwise private records.
  if p_bucket <> 'job-photos' then return false; end if;
  -- Non-owners may download an entitled photo, never enumerate or sign it.
  if not storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info']) then return false; end if;
  v_url := 'https://aegwepgtmwcnwzybpgsh.supabase.co/storage/v1/object/public/' || p_bucket || '/' || p_name;
  return exists (
    select 1 from public.jobs j
    where j.status in ('open','closed')
      and (p_owner = j.farmer_id::text or exists (
        select 1 from private.listing_photo_legacy_access l
        where l.bucket_id=p_bucket and l.object_name=p_name and l.farmer_id=j.farmer_id))
      and exists (select 1 from private.listing_photo_urls(j.photos,j.danger_places,j.danger_tasks) u(url) where u.url=v_url)
      and (
        (j.unlisted_reason is null and not public.is_account_moderated(j.farmer_id)
          and (j.status='open' or (j.headcount > 0 and
            (select count(*) from public.applications a where a.job_number=j.job_number
              and a.terms_confirmed_worker_at is not null and a.terms_confirmed_farmer_at is not null) >= j.headcount)))
        or exists (select 1 from public.applications a where a.job_number=j.job_number and a.worker_id=v_uid
          and a.status in ('applied','approved','meeting','interview','contracted','working','completed'))
      )
  );
end;
$$;
revoke all on function private.can_read_listing_photo(text,text,text) from public;
grant usage on schema private to anon;
grant execute on function private.can_read_listing_photo(text,text,text) to anon;
alter policy "listing photos authorized read" on storage.objects to anon, authenticated;

commit;
