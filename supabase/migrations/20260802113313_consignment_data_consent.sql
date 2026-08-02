-- 登録情報の委託機能での利用同意ログ（2026-08-02たきと指示・個人データの目的明示と第三者提供への事前同意設計）。
-- 同意文を変更したら version を更新（例：consignment-data-v1-2026-08）＝旧版の同意は再同意を求める。
-- consent_user_id は auth_id と同値だが、同意ログの独立性のため明示保存（行動記録の憲法・柱1）
alter table public.consignment_profiles
  add column if not exists consignment_data_consent         boolean not null default false,
  add column if not exists consignment_data_consent_at      timestamptz,
  add column if not exists consignment_data_consent_version text not null default '',
  add column if not exists consignment_data_consent_user_id uuid;
