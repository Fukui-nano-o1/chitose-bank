create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

create table if not exists public.consignment_deals (
  id uuid primary key default gen_random_uuid(),
  counterparty_name text not null default '',
  field_name text not null default '',
  area_a numeric,
  crop text default '', task text default '',
  unit_price int, total_amount int, deposit_amount int,
  spec jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  agreed_at date, start_date date, end_date date, inspected_at date, paid_at date,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.consignment_deals enable row level security;
create policy "consignment admin only" on public.consignment_deals
  for all to authenticated
  using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()))
  with check (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));
create trigger consignment_touch before update on public.consignment_deals
  for each row execute function public.touch_updated_at();