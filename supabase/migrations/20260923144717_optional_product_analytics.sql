-- Optional, consented product measurement. No account/job IDs, text, URLs, or IP columns.
-- Public clients can INSERT only the fixed event schema; only admins can SELECT.
create table public.product_events (
  session_id uuid not null,
  sequence integer not null check (sequence between 1 and 500),
  created_at timestamptz not null default now(),
  event text not null check (event in ('page_view','apply_start','apply_success','apply_failure','publish_start','publish_success','publish_failure','pdf_start','pdf_success','pdf_failure')),
  screen text not null check (screen in ('search','job','apply','publish','profile','schedule','calendar','chat','login','help','privacy','other')),
  source text not null check (source in ('direct','instagram','qr','line','other')),
  operation_id uuid,
  duration_bucket text check (duration_bucket in ('lt1s','1to5s','5to20s','over20s')),
  consent_version text not null check (consent_version = '2026-09-23'),
  consent_at timestamptz not null,
  primary key (session_id, sequence),
  check ((event = 'page_view' and operation_id is null and duration_bucket is null)
    or (event like '%_start' and operation_id is not null and duration_bucket is null)
    or (event ~ '_(success|failure)$' and operation_id is not null and duration_bucket is not null))
);
create index product_events_created_at_idx on public.product_events (created_at);
create unique index product_events_start_idx on public.product_events (operation_id) where event like '%_start';
create unique index product_events_result_idx on public.product_events (operation_id) where event ~ '_(success|failure)$';
alter table public.product_events enable row level security;
revoke all on public.product_events from public, anon, authenticated;
grant insert (session_id, sequence, event, screen, source, operation_id, duration_bucket, consent_version, consent_at) on public.product_events to anon, authenticated;
grant select on public.product_events to authenticated;
create policy product_events_insert on public.product_events for insert to anon, authenticated
  with check (consent_version = '2026-09-23' and consent_at <= now() + interval '5 minutes' and consent_at > now() - interval '180 days');
create policy product_events_admin_select on public.product_events for select to authenticated
  using (exists (select 1 from public.app_admins where auth_id = (select auth.uid())));

create or replace function public.admin_product_analytics(p_days integer default 7)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with measured as (
    select * from public.product_events
    where created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days,7),30)))
  ), pages as (
    select screen, count(*) as views, count(distinct session_id) as sessions
    from measured where event = 'page_view' group by screen
  ), sources as (
    select source, count(distinct session_id) as sessions from measured group by source
  ), operations as (
    select operation_id, split_part(event,'_',1) as name,
      min(created_at) filter (where event like '%_start') as started,
      bool_or(event like '%_success') as succeeded,
      bool_or(event like '%_failure') as failed,
      bool_or(duration_bucket = 'over20s') as slow
    from measured where operation_id is not null group by operation_id, split_part(event,'_',1)
  ), results as (
    select names.name, count(o.started) as started,
      count(*) filter (where o.started is not null and o.succeeded) as succeeded,
      count(*) filter (where o.started is not null and o.failed) as failed,
      count(*) filter (where o.started is not null and not o.succeeded and not o.failed and o.started > now() - interval '30 minutes') as in_progress,
      count(*) filter (where o.started is not null and not o.succeeded and not o.failed and o.started <= now() - interval '30 minutes') as unrecorded,
      count(*) filter (where o.started is not null and o.slow) as slow
    from (values ('apply'),('publish'),('pdf')) as names(name)
    left join operations o on o.name = names.name group by names.name
  ) select jsonb_build_object(
    'sessions', (select count(distinct session_id) from measured),
    'pages', coalesce((select jsonb_agg(to_jsonb(p) order by p.views desc) from pages p),'[]'::jsonb),
    'sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.sessions desc) from sources s),'[]'::jsonb),
    'operations', coalesce((select jsonb_agg(to_jsonb(r) order by r.name) from results r),'[]'::jsonb)
  ) where exists (select 1 from public.app_admins where auth_id = (select auth.uid()));
$$;
revoke all on function public.admin_product_analytics(integer) from public, anon;
grant execute on function public.admin_product_analytics(integer) to authenticated;

-- Retire the old, always-on visitor collector, including cached clients.
drop policy if exists "pe insert anon measure" on public.page_events;

-- Removing data older than 29 days daily keeps the promised maximum below 30 days.
select cron.schedule('purge-product-events', '17 2 * * *',
  $$delete from public.product_events where created_at < now() - interval '29 days'$$);
