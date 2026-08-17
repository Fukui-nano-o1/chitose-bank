-- 新着メッセージ通知メール・構成v3（2026-08-16たきと指示）
-- 「チャットのメール通知。〇〇さん／内容全文。／該当するチャットリンク。／お問い合わせリンク。／その他。」
--
-- 構成（本文の並び＝指示どおり）：
--  1. 〇〇さん（送信者名）からメッセージが届きました
--  2. メッセージの【全文】＋送信日時（★100文字折りたたみ（20260814084154）は本指示「内容全文」で撤回）
--  3. 該当するチャットへのリンク（HTMLは緑ボタン）
--  4. お問い合わせリンク＝チャット一覧（#/chats・運営チャットの浮遊ボタンがある面）
--  5. その他＝M20脚注（自前・件名が名前のみので mail_registry の件名マッチが効かない＝20260814082846参照）
--
-- 不変：件名＝送信者の表示名のみ／名前は役割で解決／アプリ内通知は冒頭20字

create or replace function public.trg_notify_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_worker uuid; v_farmer uuid; v_job int; v_recipient uuid;
  v_link text; v_viewer text; v_ref text; v_name text; v_sent text;
  v_contact text; v_footer_text text; v_footer_html text;
begin
  select worker_id, farmer_id, job_number into v_worker, v_farmer, v_job
    from public.applications where id = new.application_id;
  if v_worker is null then return new; end if;
  v_recipient := case when new.sender_id = v_farmer then v_worker else v_farmer end;

  v_link := 'https://chitose-bank.com/#/chat/' || new.application_id;
  v_contact := 'https://chitose-bank.com/#/chats'; -- お問い合わせ＝チャット一覧（運営チャットの入口）
  v_viewer := case when v_recipient = v_farmer then 'farmer' else 'worker' end;
  v_ref := public.job_ref(v_job, v_viewer);

  -- 送信者の表示名（役割で解決・20260814082846と同じ）
  if new.sender_id = v_farmer then
    select coalesce(
      (select nullif(btrim(nickname), '') from public.employer_profiles where auth_id = new.sender_id),
      public.resolve_actor_name(new.sender_id)) into v_name;
  else
    v_name := public.resolve_actor_name(new.sender_id);
  end if;
  v_sent := to_char(new.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI');

  insert into public.notifications (farmer_id, type, message)
  values (v_recipient, 'new_message',
          'メッセージが届きました：求人 #' || v_job || '　' || left(new.body, 20));

  v_footer_text := E'\n\n―――\n' ||
    'このメールの番号：M20（使い方ガイドの「届くメール一覧」で説明しています）' || E'\n' ||
    'https://chitose-bank.com/#/help/mails';
  v_footer_html := '<p style="font-size:11px;color:#B0B0B0;border-top:1px solid #EBEBEB;'
    || 'margin-top:16px;padding-top:10px;">このメールの番号：M20'
    || '　<a href="https://chitose-bank.com/#/help/mails" style="color:#B0B0B0;">'
    || '使い方ガイドの「届くメール一覧」で説明しています</a></p>';

  begin
    perform public.send_user_email(v_recipient,
      v_name,
      v_name || 'さんからメッセージが届きました。' || E'\n' ||
      '■ ' || v_ref || E'\n\n' ||
      '【メッセージ全文】' || E'\n' ||
      new.body || E'\n\n' ||
      '送信日時：' || v_sent || '（日本時間）' || E'\n\n' ||
      '▼ このチャットを開いて返信する' || E'\n' || v_link || E'\n\n' ||
      '▼ お問い合わせ（チャット一覧の「運営チャット」からご連絡ください）' || E'\n' || v_contact ||
      v_footer_text,
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
      || '<h2 style="font-size:16px;color:#222;">' || public.h(v_name) || 'さんからメッセージが届きました</h2>'
      || '<p style="font-size:12px;color:#717171;">' || public.h(v_ref) || '</p>'
      || '<div style="font-size:14px;color:#222;padding:12px 16px;background:#F7F7F7;border-radius:10px;white-space:pre-wrap;">'
      || public.h(new.body)
      || '</div>'
      || '<p style="font-size:12px;color:#717171;margin-top:8px;">送信日時：' || v_sent || '（日本時間）</p>'
      || '<a href="' || v_link || '" style="display:inline-block;margin-top:14px;background:#00A86B;color:#fff;'
      || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
      || 'チャットを開いて返信する</a>'
      || '<p style="font-size:12px;margin-top:14px;"><a href="' || v_contact || '" style="color:#717171;">'
      || 'お問い合わせ（チャット一覧の「運営チャット」からご連絡ください）</a></p>'
      || v_footer_html
      || '</div>');
  exception when others then null; end;
  return new;
end; $function$;
