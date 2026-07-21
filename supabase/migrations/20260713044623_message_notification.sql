-- 新着メッセージの相手方通知（アプリ内＋メール・チャット直行リンク付き）。
-- 連投抑制：同一送信者→同一チャットで30分以内に前のメッセージがあれば通知しない
--（会話の往復のたびにメールが乱射されるのを防ぐ）。
create or replace function public.trg_notify_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker uuid; v_farmer uuid; v_job int;
  v_recipient uuid;
  v_recent int;
  v_link text;
begin
  select worker_id, farmer_id, job_number into v_worker, v_farmer, v_job
    from public.applications where id = new.application_id;
  if v_worker is null then return new; end if;

  v_recipient := case when new.sender_id = v_farmer then v_worker else v_farmer end;

  -- 連投抑制：直近30分に同じ送信者からのメッセージがあればスキップ
  select count(*) into v_recent
    from public.messages
   where application_id = new.application_id
     and sender_id = new.sender_id
     and id <> new.id
     and created_at > now() - interval '30 minutes';
  if v_recent > 0 then return new; end if;

  v_link := 'https://chitose-bank.com/#/chat/' || new.application_id;

  insert into public.notifications (farmer_id, type, message)
  values (v_recipient, 'new_message',
          'メッセージが届きました：求人 #' || v_job || '　' || left(new.body, 20));

  begin
    perform public.send_user_email(
      v_recipient,
      '[chitose-bank] メッセージが届きました：求人 #' || v_job,
      'チャットに新しいメッセージが届きました。' || E'\n' ||
      left(new.body, 40) || case when char_length(new.body) > 40 then '…' else '' end || E'\n\n' ||
      'チャットを開く：' || v_link,
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
      || '<h2 style="font-size:16px;color:#222;">メッセージが届きました</h2>'
      || '<p style="font-size:12px;color:#717171;">求人 #' || v_job || '</p>'
      || '<div style="font-size:14px;color:#222;padding:12px 16px;background:#F7F7F7;border-radius:10px;white-space:pre-wrap;">'
      || left(new.body, 60) || case when char_length(new.body) > 60 then '…' else '' end
      || '</div>'
      || '<a href="' || v_link || '" style="display:inline-block;margin-top:14px;background:#00A86B;color:#fff;'
      || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
      || 'チャットを開いて返信する</a></div>'
    );
  exception when others then null;
  end;

  return new;
end;
$$;

drop trigger if exists notify_message on public.messages;
create trigger notify_message
  after insert on public.messages
  for each row execute function public.trg_notify_message();