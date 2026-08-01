-- 委託者情報の振込・請求を分割（2026-07-31たきと指示）。consignor_billing は保存時に合成した表示用を維持
alter table public.consignment_profiles
  add column if not exists consignor_bank         text not null default '',
  add column if not exists consignor_bank_branch  text not null default '',
  add column if not exists consignor_account_type text not null default '',
  add column if not exists consignor_account_no   text not null default '',
  add column if not exists consignor_account_name text not null default '';
