-- 新着メッセージ通知メール：100文字超は折りたたみ（2026-08-14たきと指示・20260814082846の追補）
-- 「文字上限あるか？→無い（入力欄maxLengthなし・DB制約なし）。100文字以上は折りたたみ。
--  タップで全文表示。折りたたみも自動展開」
--
-- 設計：
--  ・100文字以下＝全文をそのまま（前回どおり）
--  ・100文字超＝先頭100文字＋「…」で畳み、続きがあることを明記。
--    ★メールの中では「タップで展開」は動かない（メールクライアントはスクリプト不可・
--      展開UIのサポートも不安定）so、タップ＝チャットを開くリンクに一本化。
--    チャット側に折りたたみは無い＝開けば常に全文（「折りたたみも自動展開」の状態）
--  ・ボタンの文言も切り替える：全文あり「チャットを開いて返信する」／
--    折りたたみ「タップで全文を表示（チャットを開く）」
--  ・件名＝相手の名前のみ・送信日時・末尾URL・M20自前脚注は前回（20260814082846）のまま

create or replace function public.trg_notify_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_worker uuid; v_farmer uuid; v_job int; v_recipient uuid;
  v_link text; v_viewer text; v_ref text; v_name text; v_sent text;
  v_footer_text text; v_footer_html text;
  v_folded boolean; v_body_show text; v_body_label text; v_btn text;
begin
  select worker_id, farmer_id, job_number into v_worker, v_farmer, v_job
    from public.applications where id = new.application_id;
  if v_worker is null then return new; end if;
  v_recipient := case when new.sender_id = v_farmer then v_worker else v_farmer end;

  v_link := 'https://chitose-bank.com/#/chat/' || new.application_id;
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

  -- 100文字で畳む（文字数はchar_length＝日本語も1文字は1）
  v_folded := char_length(new.body) > 100;
  v_body_show := case when v_folded then left(new.body, 100) || '…' else new.body end;
  v_body_label := case when v_folded then '【メッセージ（先頭100文字）】' else '【メッセージ全文】' end;
  v_btn := case when v_folded then 'タップで全文を表示（チャットを開く）' else 'チャットを開いて返信する' end;

  insert into public.notifications (farmer_id, type, message)
  values (v_recipient, 'new_message',
          'メッセージが届きました：求人 #' || v_job || '　' || left(new.body, 20));

  -- M20脚注（自前・件名が名前のみso mail_registry の件名マッチが効かない＝20260814082846参照）
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
      v_body_label || E'\n' ||
      v_body_show ||
      case when v_folded then E'\n（続きがあります。下のリンクから全文を読めます）' else '' end || E'\n\n' ||
      '送信日時：' || v_sent || '（日本時間）' || E'\n\n' ||
      v_btn || '：' || E'\n' || v_link ||
      v_footer_text,
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
      || '<h2 style="font-size:16px;color:#222;">' || public.h(v_name) || 'さんからメッセージが届きました</h2>'
      || '<p style="font-size:12px;color:#717171;">' || public.h(v_ref) || '</p>'
      || '<div style="font-size:14px;color:#222;padding:12px 16px;background:#F7F7F7;border-radius:10px;white-space:pre-wrap;">'
      || public.h(v_body_show)
      || '</div>'
      || case when v_folded then '<p style="font-size:12px;color:#717171;margin:6px 0 0;">続きがあります。下のボタンから全文を読めます。</p>' else '' end
      || '<p style="font-size:12px;color:#717171;margin-top:8px;">送信日時：' || v_sent || '（日本時間）</p>'
      || '<a href="' || v_link || '" style="display:inline-block;margin-top:14px;background:#00A86B;color:#fff;'
      || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
      || v_btn || '</a>'
      || v_footer_html
      || '</div>');
  exception when others then null; end;
  return new;
end; $function$;
