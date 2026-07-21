-- 指定ユーザーの未読数（当事者チャット＋運営DM）。プッシュ通知にアイコンバッジ数を載せる用（2026-07-19）
-- service role（Edge Function）から呼ぶ。数値のみ＝メッセージ内容は運ばない
create or replace function public.unread_count_for(p_uid uuid)
returns integer language sql security definer stable set search_path to 'public' as $$
  select (
    (select count(*) from public.messages m
       join public.applications a on a.id = m.application_id
      where (a.worker_id = p_uid or a.farmer_id = p_uid)
        and m.sender_id <> p_uid and m.read_at is null)
    +
    (select count(*) from public.admin_messages am
      where am.user_id = p_uid and am.from_admin = true and am.read_at is null)
  )::int;
$$;