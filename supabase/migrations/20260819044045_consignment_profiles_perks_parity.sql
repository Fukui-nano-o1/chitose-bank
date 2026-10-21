-- 2026-08-19 consignment_profiles: mirror the two new perks columns.
-- EmployerProfileEdit is shared by the employer lane and the consignment (black) lane and
-- upserts ONE payload into whichever table it was given, so every perks column must exist in
-- both tables. consignment_profiles already mirrors has_transport / has_parking /
-- has_commute_allowance / has_bonus / employer_pays_supplies / accessory_ok / smoking_* ;
-- without these two the consignor profile save would fail with "column does not exist".
-- No view / trigger touches these columns on this table (consignment lane is admin-only).

alter table public.consignment_profiles
  add column if not exists has_raise boolean not null default false,
  add column if not exists has_severance_pay boolean not null default false;
