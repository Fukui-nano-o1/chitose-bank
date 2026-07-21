-- お知らせ規定（2026-07-17設計）：最後の段に「〇〇する」形式のリンクを添付できるようにする
ALTER TABLE admin_notice_registry
  ADD COLUMN IF NOT EXISTS link_label text,
  ADD COLUMN IF NOT EXISTS link_hash text;

COMMENT ON COLUMN admin_notice_registry.link_label IS '最終段のリンク文言。「〇〇する」の形式に統一（規定2026-07-17）';
COMMENT ON COLUMN admin_notice_registry.link_hash IS 'リンク先のサイト内hash（例 /help, /calendar）。タップで既読化して遷移';

-- 公開中3件にリンクを設定
UPDATE admin_notice_registry SET link_label = '使い方を確認する', link_hash = '/help'
  WHERE id IN ('0746edfa-2be5-4394-bded-bad882338a8d', '2d882c82-26d7-4047-bc69-0a2ec33a931b');
UPDATE admin_notice_registry SET link_label = '作業予定を確認する', link_hash = '/calendar'
  WHERE id = '8e906b91-4f8f-47ec-9df1-4cf76cd82206';