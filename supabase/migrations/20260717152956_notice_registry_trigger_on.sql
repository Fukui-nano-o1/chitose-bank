-- お知らせの展開機会（2026-07-17）：'startup'=起動時（従来通り）／'login'=ログイン画面を開いたとき
ALTER TABLE admin_notice_registry
  ADD COLUMN IF NOT EXISTS trigger_on text NOT NULL DEFAULT 'startup';

COMMENT ON COLUMN admin_notice_registry.trigger_on IS '展開機会: startup=起動時 / login=ログイン画面を開いたとき（未読なら表示・✕で既読は共通）';

-- ログイン方法のお知らせ＝ログインをタップした時に展開・対象は全員・期間2026/7/16〜8/31（JST・既存値で確認済み）
UPDATE admin_notice_registry
SET trigger_on = 'login',
    audience = 'all',
    starts_at = '2026-07-16T00:00:00+09:00',
    ends_at = '2026-08-31T23:59:00+09:00'
WHERE id = '0746edfa-2be5-4394-bded-bad882338a8d';