-- page_events: add src (traffic source from ?src= query param) and anon_key
-- (random per-device UUID kept in localStorage for non-logged-in visitors),
-- and allow INSERT-only access for the anon role. 2026-08-22.
--
-- Walls:
--  * anon has NO select/update/delete policy = reads stay closed (admin-only via "pe select admin").
--  * anon rows cannot impersonate a logged-in user (auth_id must be null),
--    must carry an anon_key, cannot pre-set summarized, and payload sizes are capped.
--  * 30-day retention: existing cron purge-page-events deletes by ts, so anon rows
--    are covered automatically (no new purge needed).
-- Frontend counterpart: src/lib/visitSource.js + the page logger in src/App.jsx.

alter table public.page_events alter column auth_id drop not null;
alter table public.page_events add column if not exists src text;
alter table public.page_events add column if not exists anon_key uuid;

comment on column public.page_events.src is
  'traffic source taken from the ?src= query param (e.g. insta). max 64 chars enforced by the anon insert policy';
comment on column public.page_events.anon_key is
  'random per-device UUID from localStorage for non-logged-in visitors. not linked to auth.users';

drop policy if exists "pe insert anon measure" on public.page_events;
create policy "pe insert anon measure" on public.page_events
  for insert to anon
  with check (
    auth_id is null
    and anon_key is not null
    and summarized = false
    and char_length(page_hash) <= 300
    and (src is null or char_length(src) <= 64)
  );
