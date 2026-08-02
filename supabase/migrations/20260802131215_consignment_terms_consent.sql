-- 委託機能利用特約への同意ログ（2026-08-02たきと指示・特約本文はフロント定数）。
-- データ利用同意（consignment_data_consent）とは別の同意対象＝別の列で記録する。
-- 特約本文を変更したら version を更新＝旧版の同意者には再同意を求める
alter table public.consignment_profiles
  add column if not exists consignment_terms_consent         boolean not null default false,
  add column if not exists consignment_terms_consent_at      timestamptz,
  add column if not exists consignment_terms_consent_version text not null default '',
  add column if not exists consignment_terms_consent_user_id uuid;
