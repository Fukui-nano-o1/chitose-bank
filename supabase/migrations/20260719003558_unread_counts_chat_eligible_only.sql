-- 未読バッジの誤カウント修正（2026-07-19）：
-- ①未読の集計を「チャット一覧に表示される段階」（approved〜working）だけに限定。
--   完了・見送り案件のスレッドは一覧から開けない＝既読化できないため、数えると永久にバッジが残る
CREATE OR REPLACE FUNCTION public.my_unread_message_counts()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'chat', (SELECT count(*) FROM messages m JOIN applications a ON a.id = m.application_id
             WHERE (a.worker_id = auth.uid() OR a.farmer_id = auth.uid())
               AND a.status IN ('approved','meeting','interview','contracted','working')
               AND m.sender_id <> auth.uid() AND m.read_at IS NULL),
    'dm', (SELECT count(*) FROM admin_messages am
           WHERE am.user_id = auth.uid() AND am.from_admin AND am.read_at IS NULL),
    'by_application', (SELECT coalesce(json_object_agg(t.application_id, t.cnt), '{}'::json) FROM (
        SELECT m.application_id, count(*) AS cnt
        FROM messages m JOIN applications a ON a.id = m.application_id
        WHERE (a.worker_id = auth.uid() OR a.farmer_id = auth.uid())
          AND a.status IN ('approved','meeting','interview','contracted','working')
          AND m.sender_id <> auth.uid() AND m.read_at IS NULL
        GROUP BY m.application_id) t)
  );
$$;

-- ②既に読まれている過去分の後始末：チャット一覧から開けない段階（完了等）の未読を既読化
UPDATE public.messages m
SET read_at = now()
FROM applications a
WHERE a.id = m.application_id
  AND m.read_at IS NULL
  AND a.status NOT IN ('approved','meeting','interview','contracted','working');