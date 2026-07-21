-- チャットのリアルタイム化（2026-07-19）：messages・admin_messagesをRealtime配信対象に追加。
-- 配信はRLSに従う（messages=当事者のみ／admin_messages=本人+管理者のみ）＝他人のチャットは受信できない
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.admin_messages;