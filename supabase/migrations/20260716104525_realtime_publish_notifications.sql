-- 承認ポップアップのリアルタイム受信用：notificationsをRealtime配信対象に追加。
-- RLS(notifications_own: auth.uid()=farmer_id)がRealtimeにも適用されるため、本人以外に行は流れない
alter publication supabase_realtime add table public.notifications;