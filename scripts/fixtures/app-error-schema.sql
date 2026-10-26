-- Minimal production app_errors schema and policies, inspected 2026-10-26.
-- All rows and authentication sessions in this fixture are synthetic.
create role anon; create role authenticated; create schema auth;
create function auth.jwt() returns jsonb language sql stable as
  $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as
  $$select (auth.jwt()->>'sub')::uuid$$;
grant usage on schema auth to anon,authenticated;
create table auth.users(id uuid primary key,email text);
create table public.admin_messages(id uuid default gen_random_uuid(),user_id uuid,from_admin boolean,body text,created_at timestamptz default now());
create table public.app_errors(
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  session_id text,
  user_id uuid,
  level text default 'error'::text not null,
  source text,
  page text,
  component text,
  action text,
  operation text,
  error_code text,
  message text,
  stack text,
  url text,
  user_agent text,
  metadata jsonb default '{}'::jsonb,
  status text default 'open'::text not null,
  admin_note text,
  resolved_at timestamp with time zone,
  primary key(id)
);
alter table public.app_errors enable row level security;
grant select,insert,update,delete on public.app_errors to anon,authenticated;
create policy anyone_insert_app_errors on public.app_errors for insert to anon,authenticated with check(true);
create policy admin_select_app_errors on public.app_errors for select to authenticated
  using((auth.jwt()->>'email')='t5fki6643qty@gmail.com');
create policy admin_update_app_errors on public.app_errors for update to authenticated
  using((auth.jwt()->>'email')='t5fki6643qty@gmail.com')
  with check((auth.jwt()->>'email')='t5fki6643qty@gmail.com');
