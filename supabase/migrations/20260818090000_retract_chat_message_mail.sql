-- チャットのメール通知を撤回する（2026-08-18たきと指示「チャットのメール通知は撤回」）
--
-- 【止めるもの】新着メッセージのメール（M20）だけ。
-- 【残すもの】アプリ内のお知らせ（notifications の行）／プッシュ通知／メッセージ本体と
--   その保全（trg_messages_history_lock_upd/del）は一切触らない。
--   運営への実況メールは 2026-08-17 に停止済み＝これで「チャットで飛ぶメール」は無くなる。
--
-- 【作り】trg_notify_message の呼び先を1トークンだけ差し替える。
--   本文（長い日本語）を書き写すと化けるため、いま本番にある定義を土台に置換する
--   （2026-08-16の教訓・先行するマイグレーションと同じ作法）。置換が1回であることを検査する。
--
-- ★キルスイッチ：app_settings.chat_message_mail を 'true' にすれば従来どおりメールが届く
--   （デプロイ不要）。'true' に戻したときは、プッシュのある人には送らない従来の判定
--   （send_user_email_unless_push）がそのまま働く。

insert into public.app_settings (key, value)
values ('chat_message_mail', 'false')
on conflict (key) do update set value = 'false';

-- チャットのメールの唯一の窓口。既定は送らない
create or replace function public.chat_message_mail_send(
  p_auth_id uuid, p_subject text, p_body text, p_html text default null)
returns bigint language plpgsql security definer set search_path to 'public' as $$
begin
  if not coalesce((select value = 'true' from public.app_settings where key = 'chat_message_mail'), false) then
    return null;  -- 撤回中：チャットのメールは送らない（お知らせとプッシュで届く）
  end if;
  return public.send_user_email_unless_push(p_auth_id, p_subject, p_body, p_html);
end $$;

revoke all on function public.chat_message_mail_send(uuid, text, text, text) from public;
revoke all on function public.chat_message_mail_send(uuid, text, text, text) from anon;
revoke all on function public.chat_message_mail_send(uuid, text, text, text) from authenticated;

do $$
declare v_def text; v_new text; v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trg_notify_message';
  if v_def is null then raise exception 'trg_notify_message が見つからない'; end if;

  v_hits := (length(v_def) - length(replace(v_def, 'public.send_user_email_unless_push(', '')))
            / length('public.send_user_email_unless_push(');
  if v_hits = 0 and position('public.chat_message_mail_send(' in v_def) > 0 then
    return;  -- 適用済み（冪等）
  end if;
  if v_hits <> 1 then raise exception '呼び出しが % 箇所（1箇所であるべき）', v_hits; end if;

  v_new := replace(v_def, 'public.send_user_email_unless_push(', 'public.chat_message_mail_send(');
  execute v_new;
end $$;
