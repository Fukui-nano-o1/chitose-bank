-- 委託者情報の住所を4分割（2026-07-31たきと指示）。consignor_address は保存時に合成した表示用を維持
alter table public.consignment_profiles
  add column if not exists consignor_zip  text not null default '',
  add column if not exists consignor_pref text not null default '',
  add column if not exists consignor_city text not null default '',
  add column if not exists consignor_addr text not null default '';
