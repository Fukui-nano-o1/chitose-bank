-- 新着メッセージでプッシュ送信をトリガー（2026-07-19）。pg_netでsend-push Edge Functionを非同期POST。
-- 送信先＝相手方。内容はEdge Function側で固定文（本文は運ばない）。

create or replace function public.notify_push_on_message()
returns trigger language plpgsql security definer set search_path to 'public','net' as $$
declare v_worker uuid; v_farmer uuid; v_recipient uuid; v_secret text; v_url text;
begin
  select worker_id, farmer_id into v_worker, v_farmer from public.applications where id = new.application_id;
  if v_worker is null then return new; end if;
  v_recipient := case when new.sender_id = v_worker then v_farmer else v_worker end;
  if v_recipient is null then return new; end if;
  -- 相手が購読していなければ何もしない（無駄打ち回避）
  if not exists (select 1 from public.push_subscriptions ps where ps.auth_id = v_recipient) then return new; end if;
  select trigger_secret into v_secret from public.push_config where id = 1;
  v_url := 'https://aegwepgtmwcnwzybpgsh.supabase.co/functions/v1/send-push';
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-trigger-secret', v_secret),
    body := jsonb_build_object('recipient_id', v_recipient));
  return new;
exception when others then return new; end; $$;

drop trigger if exists trg_notify_push_message on public.messages;
create trigger trg_notify_push_message after insert on public.messages
for each row execute function public.notify_push_on_message();

-- 運営DM（運営→利用者）でも通知
create or replace function public.notify_push_on_admin_message()
returns trigger language plpgsql security definer set search_path to 'public','net' as $$
declare v_secret text; v_url text;
begin
  if not new.from_admin then return new; end if;
  if not exists (select 1 from public.push_subscriptions ps where ps.auth_id = new.user_id) then return new; end if;
  select trigger_secret into v_secret from public.push_config where id = 1;
  v_url := 'https://aegwepgtmwcnwzybpgsh.supabase.co/functions/v1/send-push';
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-trigger-secret', v_secret),
    body := jsonb_build_object('recipient_id', new.user_id));
  return new;
exception when others then return new; end; $$;

drop trigger if exists trg_notify_push_admin_message on public.admin_messages;
create trigger trg_notify_push_admin_message after insert on public.admin_messages
for each row execute function public.notify_push_on_admin_message();