-- 新着メッセージ通知メールの改定（2026-08-14たきと指示）
-- 「タイトルは氏名のみ。入力内容の全文を明記。いつ送信したか明記。最後にタップで遷移できるURLを添付」
--
-- 変更点（trg_notify_message）：
--  1. 件名＝送信者の表示名のみ（従来「[chitose-bank] メッセージが届きました：求人 #N」）
--  2. 本文＝メッセージの【全文】（従来はテキスト40字・HTML60字で切り詰め）
--  3. 送信日時（日本時間）を明記
--  4. チャットへのURL（HTMLはボタン）を最後に配置
--
-- 設計メモ：
--  ・送信者名は「この取引での役割」で解決（20260803000447 calendar_partner_name_by_role と同じ規則。
--    両役持ちの農家が働き手ニックネームで出る取り違えを避ける）。退会者は resolve_actor_name が
--    「退会した利用者」を返す既定にそのまま乗る
--  ・★件名が名前のみになったため、send_user_email の mail_registry 件名マッチ（M20）が効かない。
--    M20の脚注はこのトリガーが自前で付ける（send_user_email 側は件名不一致so二重には付かない）。
--    send_user_email の脚注の書式を変えたらここも合わせること
--  ・メッセージ全文はHTML側で public.h() エスケープ＋white-space:pre-wrap（従来と同じ作法・全文になっただけ）
--  ・アプリ内通知（notifications）は従来どおり冒頭20字（一覧の1行表示so全文にしない）

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
begin
  select worker_id, farmer_id, job_number into v_worker, v_farmer, v_job
    from public.applications where id = new.application_id;
  if v_worker is null then return new; end if;
  v_recipient := case when new.sender_id = v_farmer then v_worker else v_farmer end;
  -- 30分スロットルは撤廃済み（20260722170000・例外なし・全メッセージで通知）

  v_link := 'https://chitose-bank.com/#/chat/' || new.application_id;
  v_viewer := case when v_recipient = v_farmer then 'farmer' else 'worker' end;
  v_ref := public.job_ref(v_job, v_viewer);

  -- 送信者の表示名（役割で解決）：農家として送ったなら雇い手ニックネーム優先
  if new.sender_id = v_farmer then
    select coalesce(
      (select nullif(btrim(nickname), '') from public.employer_profiles where auth_id = new.sender_id),
      public.resolve_actor_name(new.sender_id)) into v_name;
  else
    v_name := public.resolve_actor_name(new.sender_id); -- 働き手ニックネーム優先の既定どおり
  end if;
  v_sent := to_char(new.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI');

  insert into public.notifications (farmer_id, type, message)
  values (v_recipient, 'new_message',
          'メッセージが届きました：求人 #' || v_job || '　' || left(new.body, 20));

  -- M20脚注（自前・上の設計メモ参照）
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
      'チャットを開いて返信する：' || E'\n' || v_link ||
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
      || v_footer_html
      || '</div>');
  exception when others then null; end;
  return new;
end; $function$;
