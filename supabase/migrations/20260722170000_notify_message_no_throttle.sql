-- チャット通知の例外撤廃（2026-07-22・たっきー指示「全てのチャットに通知を。例外はない」）。
-- 旧trg_notify_messageは「同じ送信者が直近30分に送っていたら通知しない」スロットルがあり、
-- 会話が続くと2通目以降の通知（アプリ内notifications＋メール）が来なかった。これを撤廃し全メッセージで通知する。
-- push側（notify_push_on_message）は元からスロットル無し（購読があれば毎回送信）。
create or replace function public.trg_notify_message()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_worker uuid; v_farmer uuid; v_job int; v_recipient uuid;
  v_link text; v_viewer text; v_ref text;
begin
  select worker_id, farmer_id, job_number into v_worker, v_farmer, v_job
    from public.applications where id = new.application_id;
  if v_worker is null then return new; end if;
  v_recipient := case when new.sender_id = v_farmer then v_worker else v_farmer end;
  -- 30分スロットルは撤廃（例外なし・全メッセージで通知）

  v_link := 'https://chitose-bank.com/#/chat/' || new.application_id;
  v_viewer := case when v_recipient = v_farmer then 'farmer' else 'worker' end;
  v_ref := public.job_ref(v_job, v_viewer);

  insert into public.notifications (farmer_id, type, message)
  values (v_recipient, 'new_message',
          'メッセージが届きました：求人 #' || v_job || '　' || left(new.body, 20));
  begin
    perform public.send_user_email(v_recipient,
      '[chitose-bank] メッセージが届きました：求人 #' || v_job,
      '■ ' || v_ref || E'\n\n' ||
      'チャットに新しいメッセージが届きました。' || E'\n' ||
      left(new.body, 40) || case when char_length(new.body) > 40 then '…' else '' end || E'\n\n' ||
      'チャットを開く：' || v_link,
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
      || '<h2 style="font-size:16px;color:#222;">メッセージが届きました</h2>'
      || '<p style="font-size:12px;color:#717171;">' || public.h(v_ref) || '</p>'
      || '<div style="font-size:14px;color:#222;padding:12px 16px;background:#F7F7F7;border-radius:10px;white-space:pre-wrap;">'
      || public.h(left(new.body, 60)) || case when char_length(new.body) > 60 then '…' else '' end
      || '</div>'
      || '<a href="' || v_link || '" style="display:inline-block;margin-top:14px;background:#00A86B;color:#fff;'
      || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
      || 'チャットを開いて返信する</a></div>');
  exception when others then null; end;
  return new;
end; $function$;
