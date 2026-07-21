-- チャット一覧に完了スレッドを残す変更（2026-07-19履歴保全）に伴い、未読集計にもcompletedを戻す。
-- 完了スレッドは一覧から開けるようになったため「開けないのに数える」問題は起きない
CREATE OR REPLACE FUNCTION public.my_unread_message_counts()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'chat', (SELECT count(*) FROM messages m JOIN applications a ON a.id = m.application_id
             WHERE (a.worker_id = auth.uid() OR a.farmer_id = auth.uid())
               AND a.status IN ('approved','meeting','interview','contracted','working','completed')
               AND m.sender_id <> auth.uid() AND m.read_at IS NULL),
    'dm', (SELECT count(*) FROM admin_messages am
           WHERE am.user_id = auth.uid() AND am.from_admin AND am.read_at IS NULL),
    'by_application', (SELECT coalesce(json_object_agg(t.application_id, t.cnt), '{}'::json) FROM (
        SELECT m.application_id, count(*) AS cnt
        FROM messages m JOIN applications a ON a.id = m.application_id
        WHERE (a.worker_id = auth.uid() OR a.farmer_id = auth.uid())
          AND a.status IN ('approved','meeting','interview','contracted','working','completed')
          AND m.sender_id <> auth.uid() AND m.read_at IS NULL
        GROUP BY m.application_id) t)
  );
$$;