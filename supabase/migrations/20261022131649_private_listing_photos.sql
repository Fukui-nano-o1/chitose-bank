-- Private media rollout. Deploy ListingPhoto before applying this migration.
-- Existing URLs are identifiers only; no user records or image bytes are rewritten.
create schema if not exists private;

create or replace function private.listing_photo_urls(p_photos jsonb, p_places jsonb, p_tasks jsonb)
returns setof text language sql immutable set search_path = '' as $$
  with items as (
    select value from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(p_photos) = 'array' then p_photos else '[]'::jsonb end)
    union all
    select value from pg_catalog.jsonb_path_query(
      pg_catalog.jsonb_build_array(p_places, p_tasks), '$[*][*].photos[*]') as value
  ), urls as (
    select case when pg_catalog.jsonb_typeof(value) = 'string' then value else value -> 'url' end as value from items
    union all select value -> 'thumb' from items
  )
  select distinct value #>> '{}' from urls where pg_catalog.jsonb_typeof(value) = 'string';
$$;
revoke all on function private.listing_photo_urls(jsonb,jsonb,jsonb) from public, anon, authenticated;

-- One-time compatibility grants for administrator-uploaded photos already
-- attached to another farmer's jobs. New arbitrary references cannot add grants.
create table private.listing_photo_legacy_access (
  bucket_id text not null,
  object_name text not null,
  farmer_id uuid not null,
  primary key (bucket_id, object_name, farmer_id)
);
alter table private.listing_photo_legacy_access enable row level security;
revoke all on private.listing_photo_legacy_access from public, anon, authenticated;

insert into private.listing_photo_legacy_access(bucket_id, object_name, farmer_id)
select distinct o.bucket_id, o.name, j.farmer_id
from public.jobs j
cross join lateral private.listing_photo_urls(j.photos,j.danger_places,j.danger_tasks) u(url)
join storage.objects o on u.url = 'https://aegwepgtmwcnwzybpgsh.supabase.co/storage/v1/object/public/' || o.bucket_id || '/' || o.name
where o.bucket_id = 'job-photos' and o.owner_id <> j.farmer_id::text
  and exists (select 1 from public.app_admins a where a.auth_id::text = o.owner_id)
on conflict do nothing;

-- Preserve the existing administrator thumbnail-maintenance workflow. Only an
-- authenticated administrator can grant a farmer access to an admin upload.
create or replace function private.remember_admin_listing_photos()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.app_admins a where a.auth_id=auth.uid()) then return new; end if;
  insert into private.listing_photo_legacy_access(bucket_id,object_name,farmer_id)
  select distinct o.bucket_id,o.name,new.farmer_id
  from private.listing_photo_urls(new.photos,new.danger_places,new.danger_tasks) u(url)
  join storage.objects o on u.url='https://aegwepgtmwcnwzybpgsh.supabase.co/storage/v1/object/public/' || o.bucket_id || '/' || o.name
  where o.bucket_id='job-photos' and o.owner_id <> new.farmer_id::text
    and exists(select 1 from public.app_admins a where a.auth_id::text=o.owner_id)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.remember_admin_listing_photos() from public,anon,authenticated;
create trigger remember_admin_listing_photos after insert or update of photos,danger_places,danger_tasks,farmer_id on public.jobs
for each row execute function private.remember_admin_listing_photos();

-- SECURITY DEFINER is confined to a non-exposed schema: the storage policy
-- needs to inspect publication/party metadata without widening jobs SELECT RLS.
create or replace function private.can_read_listing_photo(p_bucket text, p_name text, p_owner text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_url text;
begin
  if v_uid is null or p_bucket not in ('job-photos','consignment-photos') then return false; end if;
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
revoke all on function private.can_read_listing_photo(text,text,text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.can_read_listing_photo(text,text,text) to authenticated;

drop policy if exists "job-photos authenticated read" on storage.objects;
drop policy if exists "consignment-photos authenticated read" on storage.objects;
create policy "listing photos authorized read" on storage.objects for select to authenticated
using (bucket_id in ('job-photos','consignment-photos')
  and private.can_read_listing_photo(bucket_id,name,owner_id));

update storage.buckets set public=false where id in ('job-photos','consignment-photos');
