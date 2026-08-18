-- プッシュ通知が届く人には、同じ用件のメールを送らない（2026-08-18たきと指示「2回くる」）。
-- 対象はチャットのメッセージ通知だけ＝プッシュと重なる唯一のメール（M20）。
-- 承認・採用・督促などプッシュの無いお知らせは従来どおりメールで届く。
-- アプリ内のお知らせ（notifications）は残す＝消すのは「同じ用件が2回来る」ぶんだけ。
--
-- ★キルスイッチ：app_settings.mail_skip_when_push を 'false' にすれば即座に従来どおり両方届く
--   （デプロイ不要）。プッシュが静かに壊れた時に「どちらも来ない」状態へ落ちないための逃げ道。
-- ★購読が死んでいる端末は、Edge Functionが410/404で購読行を掃除する＝行が消えればメールが戻る。
insert into public.app_settings (key, value)
values ('mail_skip_when_push', 'true')
on conflict (key) do nothing;

create or replace function public.send_user_email_unless_push(
  p_auth_id uuid, p_subject text, p_body text, p_html text default null)
returns bigint language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce((select value = 'true' from public.app_settings where key = 'mail_skip_when_push'), true)
     and exists (select 1 from public.push_subscriptions ps where ps.auth_id = p_auth_id) then
    return null; -- プッシュで同じ用件が届くのでメールは送らない
  end if;
  return public.send_user_email(p_auth_id, p_subject, p_body, p_html);
end $$;

revoke all on function public.send_user_email_unless_push(uuid, text, text, text) from public;
revoke all on function public.send_user_email_unless_push(uuid, text, text, text) from anon;
revoke all on function public.send_user_email_unless_push(uuid, text, text, text) from authenticated;

-- trg_notify_message の呼び先だけを差し替える。
-- ★本文を書き写さず、いま本番にある定義の1トークンだけを置換して作り直す
--   （長い日本語の文面を写経すると化ける・2026-08-16の教訓）。置換が1回であることを検査する。
-- ※このDOブロックは「その時点の trg_notify_message」を土台にする＝先行するメール文面の
--   マイグレーション（20260816050512 等）より後に流すこと。
do $$
declare v_def text; v_new text; v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trg_notify_message';
  if v_def is null then raise exception 'trg_notify_message が見つからない'; end if;

  v_hits := (length(v_def) - length(replace(v_def, 'perform public.send_user_email(v_recipient,', '')))
            / length('perform public.send_user_email(v_recipient,');
  if v_hits <> 1 then raise exception '置換対象が % 箇所（1でない）ので中止', v_hits; end if;

  v_new := replace(v_def,
    'perform public.send_user_email(v_recipient,',
    'perform public.send_user_email_unless_push(v_recipient,');
  execute v_new;
end $$;
