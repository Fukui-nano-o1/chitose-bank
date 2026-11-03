-- SYNTHETIC TEST FIXTURE ONLY. This file is not a deployment artifact.
-- The opt-in guard below permits isolated functional tests only.
-- Production deployment uses the separately reviewed canonical migration.
begin;
do $$ begin
  if current_setting('workplace.synthetic_candidate', true) is distinct from 'local-tests-only' then
    raise exception 'WORKPLACE_CANDIDATE_NOT_APPROVED';
  end if;
  if to_regclass('private.employer_workplaces') is not null
     or exists(select 1 from storage.buckets where id='workplace-photos') then
    raise exception 'WORKPLACE_CANDIDATE_TARGET_EXISTS';
  end if;
end $$;
create schema if not exists private;
create table private.employer_workplaces (
  owner_id uuid primary key references auth.users(id),
  revision bigint not null default 0 check(revision >= 0),
  draft_photos jsonb not null default '[]'::jsonb,
  published_photos jsonb not null default '[]'::jsonb,
  publication_active boolean not null default false,
  consent_version text,
  image_consent_at timestamptz,
  people_consent_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  published_at timestamptz
);
alter table private.employer_workplaces enable row level security;
revoke all on private.employer_workplaces from public,anon,authenticated;
-- No table access: narrow functions own the complete CAS and publication checks.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('workplace-photos','workplace-photos',false,5242880,array['image/jpeg']);

-- This feature alone permits the authenticated owner (explicitly approved).
-- No admin impersonation or changes to existing profile APIs.
create function private.workplace_can_write(p_owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and auth.uid()=p_owner
   and exists(select 1 from public.employer_profiles e where e.auth_id=p_owner)
   and not public.is_account_moderated(p_owner);
$$;
revoke all on function private.workplace_can_write(uuid) from public,anon,authenticated;

-- Owner library slots include pending/deleting reservations. Logical cap only;
-- Storage provider cleanup and transient uploaded bytes are not bounded here.
create table private.workplace_photo_library (
 owner_id uuid not null references auth.users(id),
 id text not null check(id ~ '^[a-f0-9]{64}$'),
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 path text not null,
 slot integer not null check(slot between 1 and 24),
 state text not null check(state in ('pending','ready','deleting','deleted')),
 primary key(owner_id,id), unique(path),
 check(path=owner_id::text||'/'||id||'.jpg')
);
create unique index workplace_photo_active_slot on private.workplace_photo_library(owner_id,slot) where state<>'deleted';
alter table private.workplace_photo_library enable row level security;
revoke all on private.workplace_photo_library from public,anon,authenticated;

create function private.read_my_workplace_photos(p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid()<>p_owner then return jsonb_build_object('ok',false,'reason','not_owner'); end if;
 return jsonb_build_object('ok',true,'limit',24,'photos',coalesce((select jsonb_agg(jsonb_build_object('id',id,'content_hash',content_hash,'path',path,'state',state,'slot',slot) order by slot) from private.workplace_photo_library where owner_id=p_owner and state<>'deleted'),'[]'::jsonb));
end $$;

create function private.reserve_workplace_photo(p_owner uuid,p_id text,p_content_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.workplace_photo_library; free_slot integer;
begin
 if not private.workplace_can_write(p_owner) then return jsonb_build_object('ok',false,'reason','not_allowed'); end if;
 if p_id is null or p_id !~ '^[a-f0-9]{64}$' or p_content_hash is null or p_content_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'reason','invalid_photo'); end if;
 if current_setting('transaction_isolation')<>'read committed' then return jsonb_build_object('ok',false,'reason','unsupported_isolation'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into r from private.workplace_photo_library where owner_id=p_owner and id=p_id for update;
 if found then
  if r.content_hash<>p_content_hash then return jsonb_build_object('ok',false,'reason','hash_mismatch'); end if;
  if r.state in ('deleting','deleted') then return jsonb_build_object('ok',false,'reason',r.state); end if;
  return jsonb_build_object('ok',true,'photo',to_jsonb(r)-'owner_id');
 end if;
 select n into free_slot from generate_series(1,24) n where not exists(select 1 from private.workplace_photo_library where owner_id=p_owner and slot=n and state<>'deleted') order by n limit 1;
 if free_slot is null then return jsonb_build_object('ok',false,'reason','quota_exceeded'); end if;
 insert into private.workplace_photo_library values(p_owner,p_id,p_content_hash,p_owner::text||'/'||p_id||'.jpg',free_slot,'pending') returning * into r;
 return jsonb_build_object('ok',true,'photo',to_jsonb(r)-'owner_id');
end $$;

-- Lock reservation in actual INSERT transaction, including privileged Storage
-- commits. A concurrent prepare-delete must wait for this insertion to finish.
create function private.guard_workplace_photo_insert() returns trigger
language plpgsql security definer set search_path='' as $$
declare r private.workplace_photo_library;
begin
 if new.bucket_id<>'workplace-photos' then return new; end if;
 select * into r from private.workplace_photo_library where path=new.name for update;
 if not found or r.state<>'pending' or new.owner_id is distinct from r.owner_id::text then
  raise exception 'WORKPLACE_UPLOAD_NOT_RESERVED';
 end if;
 return new;
end $$;
create trigger guard_workplace_photo_insert before insert on storage.objects for each row execute function private.guard_workplace_photo_insert();

create function private.finalize_workplace_photo(p_owner uuid,p_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.workplace_photo_library;
begin
 if not private.workplace_can_write(p_owner) then return jsonb_build_object('ok',false,'reason','not_allowed'); end if;
 if current_setting('transaction_isolation')<>'read committed' then return jsonb_build_object('ok',false,'reason','unsupported_isolation'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into r from private.workplace_photo_library where owner_id=p_owner and id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
 if r.state not in ('pending','ready') then return jsonb_build_object('ok',false,'reason',r.state); end if;
 if not exists(select 1 from storage.objects where bucket_id='workplace-photos' and name=r.path and owner_id=p_owner::text) then return jsonb_build_object('ok',false,'reason','upload_pending'); end if;
 update private.workplace_photo_library set state='ready' where owner_id=p_owner and id=p_id returning * into r;
 return jsonb_build_object('ok',true,'photo',to_jsonb(r)-'owner_id');
end $$;

create function private.prepare_delete_workplace_photo(p_owner uuid,p_id text,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.workplace_photo_library; w private.employer_workplaces;
begin
 if not private.workplace_can_write(p_owner) then return jsonb_build_object('ok',false,'reason','not_allowed'); end if;
 if p_confirm is distinct from true then return jsonb_build_object('ok',false,'reason','confirmation_required'); end if;
 if current_setting('transaction_isolation')<>'read committed' then return jsonb_build_object('ok',false,'reason','unsupported_isolation'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into w from private.employer_workplaces where owner_id=p_owner for update;
 select * into r from private.workplace_photo_library where owner_id=p_owner and id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
 if exists(select 1 from jsonb_array_elements(coalesce(w.draft_photos,'[]')||coalesce(w.published_photos,'[]')) p where p->>'path'=r.path) then return jsonb_build_object('ok',false,'reason','in_use'); end if;
 if r.state='deleted' then return jsonb_build_object('ok',true,'photo',to_jsonb(r)-'owner_id'); end if;
 update private.workplace_photo_library set state='deleting' where owner_id=p_owner and id=p_id returning * into r;
 return jsonb_build_object('ok',true,'photo',to_jsonb(r)-'owner_id');
end $$;

create function private.finalize_delete_workplace_photo(p_owner uuid,p_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.workplace_photo_library;
begin
 if not private.workplace_can_write(p_owner) then return jsonb_build_object('ok',false,'reason','not_allowed'); end if;
 if current_setting('transaction_isolation')<>'read committed' then return jsonb_build_object('ok',false,'reason','unsupported_isolation'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into r from private.workplace_photo_library where owner_id=p_owner and id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
 if r.state not in ('deleting','deleted') then return jsonb_build_object('ok',false,'reason','not_deleting'); end if;
 if exists(select 1 from storage.objects where bucket_id='workplace-photos' and name=r.path) then return jsonb_build_object('ok',false,'reason','delete_pending'); end if;
 update private.workplace_photo_library set state='deleted' where owner_id=p_owner and id=p_id returning * into r;
 return jsonb_build_object('ok',true,'photo',to_jsonb(r)-'owner_id');
end $$;

create function private.can_delete_workplace_photo(p_name text,p_object_owner text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid()::text=p_object_owner and private.workplace_can_write(auth.uid())
 and exists(select 1 from private.workplace_photo_library where owner_id=auth.uid() and path=p_name and state='deleting');
$$;
revoke all on function private.guard_workplace_photo_insert(),private.can_delete_workplace_photo(text,text) from public,anon,authenticated;
grant execute on function private.can_delete_workplace_photo(text,text) to authenticated;

create function private.workplace_photos_valid(p_owner uuid,p_photos jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare p jsonb;
begin
 if p_photos is null or jsonb_typeof(p_photos)<>'array' then return false; end if;
 if jsonb_array_length(p_photos)>6 or octet_length(p_photos::text)>32768 then return false; end if;
 if (select count(distinct x->>'path') from jsonb_array_elements(p_photos) x)<>jsonb_array_length(p_photos) then return false; end if;
 for p in select value from jsonb_array_elements(p_photos) loop
   if jsonb_typeof(p)<>'object' or not(p ? 'path' and p ? 'id') then return false; end if;
   if exists(select 1 from jsonb_object_keys(p) k where k not in ('path','id')) then return false; end if;
   if jsonb_typeof(p->'id')<>'string' or (p->>'id') !~ '^[a-f0-9]{64}$' or jsonb_typeof(p->'path')<>'string'
      or (p->>'path') is distinct from (p_owner::text||'/'||(p->>'id')||'.jpg') then return false; end if;
   if not exists(select 1 from private.workplace_photo_library l where l.owner_id=p_owner and l.path=p->>'path' and l.state='ready') then return false; end if;
   if not exists(select 1 from storage.objects o where o.bucket_id='workplace-photos'
       and o.name=p->>'path' and o.owner_id=p_owner::text) then return false; end if;
 end loop;
 return true;
end $$;
revoke all on function private.workplace_photos_valid(uuid,jsonb) from public,anon,authenticated;

create function private.lock_workplace_photos(p_owner uuid,p_photos jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r private.workplace_photo_library;
begin
 if p_photos is null or jsonb_typeof(p_photos)<>'array' then return false; end if;
 for r in select * from private.workplace_photo_library where owner_id=p_owner and path in (select value->>'path' from jsonb_array_elements(p_photos)) order by path for update loop
  if r.state<>'ready' then return false; end if;
 end loop;
 return private.workplace_photos_valid(p_owner,p_photos);
end $$;
revoke all on function private.lock_workplace_photos(uuid,jsonb) from public,anon,authenticated;

create function private.read_my_workplace(p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 if auth.uid() is null or auth.uid()<>p_owner then return jsonb_build_object('ok',false,'reason','not_owner'); end if;
 select to_jsonb(w) into r from private.employer_workplaces w where owner_id=p_owner;
 return jsonb_build_object('ok',true,'row',r);
end $$;
revoke all on function private.read_my_workplace(uuid) from public,anon,authenticated;

create function private.save_my_workplace(p_owner uuid,p_expected_revision bigint,p_photos jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w private.employer_workplaces;
begin
 if not private.workplace_can_write(p_owner) then return jsonb_build_object('ok',false,'reason','not_allowed'); end if;
 if current_setting('transaction_isolation')<>'read committed' then return jsonb_build_object('ok',false,'reason','unsupported_isolation'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if p_expected_revision is null or p_expected_revision<0 then return jsonb_build_object('ok',false,'reason','invalid_revision'); end if;
 -- The empty revision 0 is the only creation baseline; concurrent first saves serialize.
 if p_expected_revision=0 then
   insert into private.employer_workplaces(owner_id) values(p_owner) on conflict do nothing;
 end if;
 select * into w from private.employer_workplaces where owner_id=p_owner for update;
 if not found or w.revision<>p_expected_revision then return jsonb_build_object('ok',false,'reason','conflict'); end if;
 if not private.lock_workplace_photos(p_owner,p_photos) then return jsonb_build_object('ok',false,'reason','invalid_photos'); end if;
 update private.employer_workplaces set draft_photos=p_photos,revision=revision+1,updated_at=clock_timestamp()
 where owner_id=p_owner returning * into w;
 return jsonb_build_object('ok',true,'row',to_jsonb(w));
end $$;
revoke all on function private.save_my_workplace(uuid,bigint,jsonb) from public,anon,authenticated;

create function private.publish_my_workplace(p_owner uuid,p_expected_revision bigint,p_image_consent boolean,p_people_consent boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w private.employer_workplaces;
begin
 if not private.workplace_can_write(p_owner) then return jsonb_build_object('ok',false,'reason','not_allowed'); end if;
 if current_setting('transaction_isolation')<>'read committed' then return jsonb_build_object('ok',false,'reason','unsupported_isolation'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into w from private.employer_workplaces where owner_id=p_owner for update;
 if not found or p_expected_revision is null or w.revision<>p_expected_revision then return jsonb_build_object('ok',false,'reason','conflict'); end if;
 if jsonb_array_length(w.draft_photos)=0 or not private.lock_workplace_photos(p_owner,w.draft_photos) then return jsonb_build_object('ok',false,'reason','invalid_photos'); end if;
 if p_image_consent is distinct from true or p_people_consent is distinct from true then return jsonb_build_object('ok',false,'reason','consent_required'); end if;
 update private.employer_workplaces set published_photos=draft_photos,publication_active=true,
   consent_version='workplace-photos-v1',image_consent_at=clock_timestamp(),
   people_consent_at=clock_timestamp(),
   published_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1
 where owner_id=p_owner returning * into w;
 return jsonb_build_object('ok',true,'row',to_jsonb(w));
end $$;
revoke all on function private.publish_my_workplace(uuid,bigint,boolean,boolean) from public,anon,authenticated;

create function private.unpublish_my_workplace(p_owner uuid,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w private.employer_workplaces;
begin
 if not private.workplace_can_write(p_owner) then return jsonb_build_object('ok',false,'reason','not_allowed'); end if;
 if current_setting('transaction_isolation')<>'read committed' then return jsonb_build_object('ok',false,'reason','unsupported_isolation'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 update private.employer_workplaces set publication_active=false,published_photos='[]'::jsonb,published_at=null,
   consent_version=null,image_consent_at=null,people_consent_at=null,revision=revision+1,updated_at=clock_timestamp()
 where owner_id=p_owner and revision=p_expected_revision returning * into w;
 if not found then return jsonb_build_object('ok',false,'reason','conflict'); end if;
 return jsonb_build_object('ok',true,'row',to_jsonb(w));
end $$;
revoke all on function private.unpublish_my_workplace(uuid,bigint) from public,anon,authenticated;

-- No precise address, extra owner fields, private draft or consent records in the public projection.
-- Object paths still contain the owner UUID, as explicitly required by the path contract.
-- Match public listing-photo eligibility, not owner/applicant-only historical access.
create function private.job_workplace(p_job_number integer) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('photos',w.published_photos,'published_at',w.published_at)
 from public.jobs j join private.employer_workplaces w on w.owner_id=j.farmer_id
 where j.job_number=p_job_number and j.status in ('open','closed') and j.unlisted_reason is null
   and (j.status='open' or (j.headcount>0 and (select count(*) from public.applications a
      where a.job_number=j.job_number and a.terms_confirmed_worker_at is not null
      and a.terms_confirmed_farmer_at is not null)>=j.headcount))
   and not public.is_account_moderated(j.farmer_id) and w.publication_active
   and w.image_consent_at is not null and w.people_consent_at is not null and w.consent_version='workplace-photos-v1'
   and private.workplace_photos_valid(w.owner_id,w.published_photos);
$$;
revoke all on function private.job_workplace(integer) from public,anon,authenticated;

create function private.can_read_workplace_photo(p_name text,p_object_owner text) returns boolean
language sql stable security definer set search_path='' as $$
 select (storage.allow_any_operation(array['object.delete','object.delete_many']) and private.can_delete_workplace_photo(p_name,p_object_owner)) or (storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info'])
 and (auth.uid()::text=p_object_owner or exists(
   select 1 from public.jobs j join private.employer_workplaces w on w.owner_id=j.farmer_id
   where j.status in ('open','closed') and j.unlisted_reason is null
   and (j.status='open' or (j.headcount>0 and (select count(*) from public.applications a
      where a.job_number=j.job_number and a.terms_confirmed_worker_at is not null
      and a.terms_confirmed_farmer_at is not null)>=j.headcount)) and not public.is_account_moderated(j.farmer_id)
   and w.owner_id::text=p_object_owner and w.publication_active and w.image_consent_at is not null and w.people_consent_at is not null
   and w.consent_version='workplace-photos-v1'
   and exists(select 1 from private.workplace_photo_library l where l.owner_id=w.owner_id and l.path=p_name and l.state='ready')
   and exists(select 1 from jsonb_array_elements(w.published_photos) p where p->>'path'=p_name)
 )));
$$;
revoke all on function private.can_read_workplace_photo(text,text) from public,anon,authenticated;
grant usage on schema private to anon,authenticated;
grant execute on function private.can_read_workplace_photo(text,text) to anon,authenticated;
grant execute on function private.workplace_can_write(uuid) to authenticated;

-- Both permissive and restrictive fences: unrelated permissive Storage policies
-- cannot turn workplace drafts public or bypass immutable/reserved-deletion checks.
create policy "workplace read" on storage.objects for select to anon,authenticated
using(bucket_id='workplace-photos' and private.can_read_workplace_photo(name,owner_id));
create policy "workplace read fence" on storage.objects as restrictive for select to anon,authenticated
using(bucket_id<>'workplace-photos' or private.can_read_workplace_photo(name,owner_id));
create policy "workplace insert" on storage.objects for insert to authenticated
with check(bucket_id='workplace-photos' and private.workplace_can_write(auth.uid())
 and owner_id=auth.uid()::text and name ~ ('^'||auth.uid()::text||'/[a-f0-9]{64}[.]jpg$'));
create policy "workplace insert fence" on storage.objects as restrictive for insert to anon,authenticated
with check(bucket_id<>'workplace-photos' or (private.workplace_can_write(auth.uid()) and owner_id=auth.uid()::text
 and name ~ ('^'||auth.uid()::text||'/[a-f0-9]{64}[.]jpg$')));
create policy "workplace immutable" on storage.objects as restrictive for update to anon,authenticated
using(bucket_id<>'workplace-photos') with check(bucket_id<>'workplace-photos');
-- Only an explicit, owner-confirmed deleting reservation permits Storage API removal.
create policy "workplace delete" on storage.objects for delete to authenticated
using(bucket_id='workplace-photos' and private.can_delete_workplace_photo(name,owner_id));
create policy "workplace delete fence" on storage.objects as restrictive for delete to anon,authenticated
using(bucket_id<>'workplace-photos' or private.can_delete_workplace_photo(name,owner_id));

-- Invoker wrappers are the only exposed API; privileged implementations remain
-- private, with explicit grants and owner checks on every mutation/read-my call.
create function public.read_my_workplace(p_owner uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.read_my_workplace(p_owner) $$;
create function public.save_my_workplace(p_owner uuid,p_expected_revision bigint,p_photos jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.save_my_workplace(p_owner,p_expected_revision,p_photos) $$;
create function public.publish_my_workplace(p_owner uuid,p_expected_revision bigint,p_image_consent boolean,p_people_consent boolean) returns jsonb language sql security invoker set search_path='' as $$ select private.publish_my_workplace(p_owner,p_expected_revision,p_image_consent,p_people_consent) $$;
create function public.unpublish_my_workplace(p_owner uuid,p_expected_revision bigint) returns jsonb language sql security invoker set search_path='' as $$ select private.unpublish_my_workplace(p_owner,p_expected_revision) $$;
create function public.job_workplace(p_job_number integer) returns jsonb language sql stable security invoker set search_path='' as $$ select private.job_workplace(p_job_number) $$;
revoke all on function public.read_my_workplace(uuid), public.save_my_workplace(uuid,bigint,jsonb), public.publish_my_workplace(uuid,bigint,boolean,boolean), public.unpublish_my_workplace(uuid,bigint), public.job_workplace(integer) from public,anon,authenticated;
grant execute on function private.read_my_workplace(uuid),private.save_my_workplace(uuid,bigint,jsonb),private.publish_my_workplace(uuid,bigint,boolean,boolean),private.unpublish_my_workplace(uuid,bigint) to authenticated;
grant execute on function public.read_my_workplace(uuid),public.save_my_workplace(uuid,bigint,jsonb),public.publish_my_workplace(uuid,bigint,boolean,boolean),public.unpublish_my_workplace(uuid,bigint) to authenticated;
grant execute on function private.job_workplace(integer),public.job_workplace(integer) to anon,authenticated;
create function public.read_my_workplace_photos(p_owner uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.read_my_workplace_photos(p_owner) $$;
revoke all on function private.read_my_workplace_photos(uuid),public.read_my_workplace_photos(uuid) from public,anon,authenticated;
grant execute on function private.read_my_workplace_photos(uuid),public.read_my_workplace_photos(uuid) to authenticated;
create function public.reserve_workplace_photo(p_owner uuid,p_id text,p_content_hash text) returns jsonb language sql security invoker set search_path='' as $$ select private.reserve_workplace_photo(p_owner,p_id,p_content_hash) $$;
revoke all on function private.reserve_workplace_photo(uuid,text,text),public.reserve_workplace_photo(uuid,text,text) from public,anon,authenticated;
grant execute on function private.reserve_workplace_photo(uuid,text,text),public.reserve_workplace_photo(uuid,text,text) to authenticated;
create function public.finalize_workplace_photo(p_owner uuid,p_id text) returns jsonb language sql security invoker set search_path='' as $$ select private.finalize_workplace_photo(p_owner,p_id) $$;
revoke all on function private.finalize_workplace_photo(uuid,text),public.finalize_workplace_photo(uuid,text) from public,anon,authenticated;
grant execute on function private.finalize_workplace_photo(uuid,text),public.finalize_workplace_photo(uuid,text) to authenticated;
create function public.prepare_delete_workplace_photo(p_owner uuid,p_id text,p_confirm boolean) returns jsonb language sql security invoker set search_path='' as $$ select private.prepare_delete_workplace_photo(p_owner,p_id,p_confirm) $$;
revoke all on function private.prepare_delete_workplace_photo(uuid,text,boolean),public.prepare_delete_workplace_photo(uuid,text,boolean) from public,anon,authenticated;
grant execute on function private.prepare_delete_workplace_photo(uuid,text,boolean),public.prepare_delete_workplace_photo(uuid,text,boolean) to authenticated;
create function public.finalize_delete_workplace_photo(p_owner uuid,p_id text) returns jsonb language sql security invoker set search_path='' as $$ select private.finalize_delete_workplace_photo(p_owner,p_id) $$;
revoke all on function private.finalize_delete_workplace_photo(uuid,text),public.finalize_delete_workplace_photo(uuid,text) from public,anon,authenticated;
grant execute on function private.finalize_delete_workplace_photo(uuid,text),public.finalize_delete_workplace_photo(uuid,text) to authenticated;
commit;

-- ROLLBACK PLAN (NOT AUTOMATICALLY RUN): after exact approval, revoke EXECUTE on
-- public AND private save/publish entry points from authenticated, and stop new
-- upload INSERT policy. Set publication_active=false on the affected workplace
-- records or revoke the public reader and make the new read fence return false
-- for non-owners. Keep workplace-photos PRIVATE and retain restrictive fences:
-- simply dropping our policies could reactivate unrelated permissive policies.
-- Do not drop the table/bucket or delete images during rollback. Existing clients
-- may retain downloaded bytes; no retroactive erasure is claimed.
-- Explicit deletion uses Storage API only after prepare-delete; never DELETE storage metadata via RPC.
-- Client finalizes only after clear API success, not timeout/unknown. Physical provider
-- residue may persist despite missing metadata; logical slots are not billing-byte guarantees.
-- Deleted asset IDs remain tombstoned; the same content can use a fresh random asset ID.
-- BEFORE A REAL MIGRATION: obtain approved exact SQL and live catalog fingerprint
-- (all Storage SELECT/ALL/INSERT/UPDATE/DELETE policies, bucket flags/limits, RLS,
-- helper definitions/ACL/owners, jobs eligibility and employer-profile existence).
-- Replace the synthetic-only preflight with exact drift checks, use the supported
-- CLI to generate a migration, and run advisors. Do not use this file as a deploy.
-- Verified reference: https://supabase.com/docs/guides/storage/security/access-control
-- Operation names: https://github.com/supabase/storage/blob/master/src/http/routes/operations.ts
-- These SQL tests do not validate actual image metadata stripping or Storage HTTP.
