-- チャット未読通知（2026-07-17）：messagesに既読時刻を追加し、未読数を数えるRPCを新設
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read_at timestamptz;
COMMENT ON COLUMN public.messages.read_at IS '受信者が既読にした時刻。NULL=未読。既読化はチャットを開いた時（受信者本人のみUPDATE可）';

-- 既読化ポリシー：応募当事者かつ送信者でない側（＝受信者）だけが更新できる
DROP POLICY IF EXISTS "msg recipient mark read" ON public.messages;
CREATE POLICY "msg recipient mark read" ON public.messages FOR UPDATE
  USING (
    sender_id <> auth.uid()
    AND EXISTS (SELECT 1 FROM applications a
                WHERE a.id = messages.application_id
                  AND (a.worker_id = auth.uid() OR a.farmer_id = auth.uid()))
  )
  WITH CHECK (
    sender_id <> auth.uid()
    AND EXISTS (SELECT 1 FROM applications a
                WHERE a.id = messages.application_id
                  AND (a.worker_id = auth.uid() OR a.farmer_id = auth.uid()))
  );

-- 未読数RPC（本人限定・自分宛の未読だけを数える）：
--   total = チャット未読＋運営DM未読（下部バーのバッジ用）
--   by_application = スレッドごとの未読数（チャット一覧のバッジ用）
--   dm = 運営DMの未読数
CREATE OR REPLACE FUNCTION public.my_unread_message_counts()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'chat', (SELECT count(*) FROM messages m JOIN applications a ON a.id = m.application_id
             WHERE (a.worker_id = auth.uid() OR a.farmer_id = auth.uid())
               AND m.sender_id <> auth.uid() AND m.read_at IS NULL),
    'dm', (SELECT count(*) FROM admin_messages am
           WHERE am.user_id = auth.uid() AND am.from_admin AND am.read_at IS NULL),
    'by_application', (SELECT coalesce(json_object_agg(t.application_id, t.cnt), '{}'::json) FROM (
        SELECT m.application_id, count(*) AS cnt
        FROM messages m JOIN applications a ON a.id = m.application_id
        WHERE (a.worker_id = auth.uid() OR a.farmer_id = auth.uid())
          AND m.sender_id <> auth.uid() AND m.read_at IS NULL
        GROUP BY m.application_id) t)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.my_unread_message_counts() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.my_unread_message_counts() TO authenticated;