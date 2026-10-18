-- Production column/trigger definitions read 2026-10-18; no user rows.
create table public.consignment_deals (
  id uuid not null default gen_random_uuid() primary key,
  counterparty_name text not null default ''::text,
  field_name text not null default ''::text,
  area_a numeric,
  crop text default ''::text,
  task text default ''::text,
  unit_price int4,
  total_amount int4,
  deposit_amount int4,
  spec jsonb not null default '{}'::jsonb,
  status text not null default 'draft'::text,
  agreed_at date,
  start_date date,
  end_date date,
  inspected_at date,
  paid_at date,
  notes text default ''::text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  spec_snapshot jsonb,
  snapshot_at timestamptz
);
create table public.consignment_fields (
  id uuid not null default gen_random_uuid() primary key,
  auth_id uuid not null,
  name text not null,
  region text not null default ''::text,
  area_a text not null default ''::text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(auth_id,name)
);
CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.updated_at := now(); return new; end; $function$;

CREATE TRIGGER consignment_touch BEFORE UPDATE ON public.consignment_deals FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE OR REPLACE FUNCTION public.trg_consign_freeze_spec()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'agreed' and (tg_op = 'UPDATE' and old.status is distinct from 'agreed') then
    if new.spec_snapshot is null then
      new.spec_snapshot := new.spec;
      new.snapshot_at := now();
    end if;
    if new.agreed_at is null then new.agreed_at := (now() at time zone 'Asia/Tokyo')::date; end if;
  end if;
  return new;
end; $function$;

CREATE TRIGGER trg_consign_freeze_spec BEFORE UPDATE ON public.consignment_deals FOR EACH ROW EXECUTE FUNCTION trg_consign_freeze_spec();
