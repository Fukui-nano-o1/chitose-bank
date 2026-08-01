-- 委託者情報（2026-07-31たきと指示・原則変更しない本人/事業者情報。設定ページで入力し案件作成時に自動反映）
alter table public.consignment_profiles
  add column if not exists consignor_name        text not null default '',
  add column if not exists consignor_trade_name  text not null default '',
  add column if not exists consignor_corp_no     text not null default '',
  add column if not exists consignor_invoice_no  text not null default '',
  add column if not exists consignor_rep_name    text not null default '',
  add column if not exists consignor_address     text not null default '',
  add column if not exists consignor_phone       text not null default '',
  add column if not exists consignor_email       text not null default '',
  add column if not exists consignor_emergency   text not null default '',
  add column if not exists consignor_billing     text not null default '';
