-- 委託者情報v2（2026-07-31たきと指示）：最初に個人事業者/法人を選び、データ構造から分離する。
-- consignor_type='individual'|'corporate'、consignor_data=ind_*/corp_*/staff_*/cmn_* のキー空間で
-- 個人名と法人名を同じ場所に入れない。旧 consignor_* 列は残置（表示のフォールバックと下敷きに使用）
alter table public.consignment_profiles
  add column if not exists consignor_type text not null default '',
  add column if not exists consignor_data jsonb not null default '{}';
