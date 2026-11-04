-- PREPARED ONLY. Named copy and no-push policy approved; do not apply/activate yet.
-- Defaults deliberately send/queue nothing. No backfill, no Auth triggers, and no
-- widening of admin_messages permissions. Registration means account_holders INSERT.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
-- This is the only pre-existing function changed. Fail closed if its reviewed
-- production definition changes before application. Never replay old migrations.
do $preflight$
begin
  if to_regprocedure('public.notify_push_on_admin_message()') is null or
    md5(pg_get_functiondef('public.notify_push_on_admin_message()'::regprocedure))
      is distinct from 'b13e9fafbea826c2e9a3cd2aa13e4169' then
    raise exception 'OPERATOR_GREETING_PUSH_SCHEMA_DRIFT';
  end if;
end;
$preflight$;
create schema if not exists private;

create table private.operator_greeting_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  enabled_at timestamptz,
  registration_body text,
  registration_named_body text,
  login_body text,
  login_named_body text,
  check (not enabled or (
    enabled_at is not null
    and length(btrim(registration_body)) between 1 and 4000
    and length(btrim(login_body)) between 1 and 4000
    and registration_body is not null and login_body is not null
    and registration_named_body is not null and login_named_body is not null
    and length(btrim(registration_named_body)) between 1 and 3900
    and length(btrim(login_named_body)) between 1 and 3900
    and strpos(registration_body, '{{name}}') = 0 and strpos(login_body, '{{name}}') = 0
    and length(registration_named_body) - length(replace(registration_named_body,'{{name}}','')) = 8
    and length(login_named_body) - length(replace(login_named_body,'{{name}}','')) = 8
  ))
);
-- Approved copy, stored inactive. Nameless variants omit only the unavailable
-- salutation; they never substitute legal names, email addresses, or literal 〇〇.
insert into private.operator_greeting_config(
  singleton,registration_named_body,registration_body,login_named_body,login_body
) values(
  true,
  '{{name}}さん、Chitose-bankへようこそ！ こちらは運営とのチャットです。使い方で分からないことや、お困りのことがあれば、こちらからお問い合わせください。',
  'Chitose-bankへようこそ！ こちらは運営とのチャットです。使い方で分からないことや、お困りのことがあれば、こちらからお問い合わせください。',
  'おかえりなさい、{{name}}さん！ お困りのことがあれば、いつでもこのチャットでお知らせください。',
  'おかえりなさい！ お困りのことがあれば、いつでもこのチャットでお知らせください。'
);
alter table private.operator_greeting_config enable row level security;
revoke all on private.operator_greeting_config from public, anon, authenticated;

-- The event is the idempotency key, including after logout removes auth.sessions.
-- Never cascade from auth.sessions: deleting a session must not erase its receipt.
create table private.operator_greeting_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid,
  kind text not null check (kind in ('registration','login')),
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default clock_timestamp(),
  message_id uuid unique,
  check (kind = 'registration' or session_id is not null),
  unique(user_id, session_id)
);
create unique index operator_greeting_registration_once
  on private.operator_greeting_events(user_id) where kind = 'registration';
create index operator_greeting_pending
  on private.operator_greeting_events(user_id, created_at) where message_id is null;
alter table private.operator_greeting_events enable row level security;
revoke all on private.operator_greeting_events from public, anon, authenticated;

-- Only automatic greeting IDs are silent. Manual operator messages keep their
-- existing push path. The private event receipt is set before INSERT, inside the
-- same subtransaction, so this trigger can verify it without client-controlled
-- flags, session settings, or weakening admin_messages permissions.
create or replace function public.notify_push_on_admin_message()
returns trigger language plpgsql security definer set search_path to 'public','net' as $$
declare v_secret text; v_url text;
begin
  if not new.from_admin then return new; end if;
  if exists (select 1 from private.operator_greeting_events e
    where e.message_id = new.id and e.user_id = new.user_id) then return new; end if;
  if not exists (select 1 from public.push_subscriptions ps where ps.auth_id = new.user_id) then return new; end if;
  select trigger_secret into v_secret from public.push_config where id = 1;
  v_url := 'https://aegwepgtmwcnwzybpgsh.supabase.co/functions/v1/send-push';
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-trigger-secret', v_secret),
    body := jsonb_build_object('recipient_id', new.user_id, 'kind', 'admin', 'id', new.id));
  return new;
exception when others then return new; end; $$;

-- Match the operator-chat display name, never the private account-holder legal
-- name or email. Missing profiles use an explicitly reviewed nameless template.
create function private.render_operator_greeting(p_user uuid,p_named_body text,p_body text)
returns text language sql security invoker set search_path = '' as $$
  select case when name is null then p_body else replace(p_named_body,'{{name}}',name) end
  from (select coalesce(
    (select nullif(left(btrim(regexp_replace(w.nickname,'[[:cntrl:]]','','g')),80),'')
      from public.worker_profiles w where w.auth_id=p_user),
    (select nullif(left(btrim(regexp_replace(e.nickname,'[[:cntrl:]]','','g')),80),'')
      from public.employer_profiles e where e.auth_id=p_user)
  ) as name) n;
$$;
revoke all on function private.render_operator_greeting(uuid,text,text) from public, anon, authenticated;

-- This only records a durable event. Chat/push failures cannot roll back signup.
create function private.queue_operator_registration_greeting()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_config private.operator_greeting_config; v_session uuid;
begin
  select * into v_config from private.operator_greeting_config where singleton for share;
  if not coalesce(v_config.enabled, false) then return new; end if;
  if auth.uid() = new.auth_id then
    select s.id into v_session from auth.sessions s
      where s.id = nullif(auth.jwt()->>'session_id','')::uuid and s.user_id = new.auth_id;
  end if;
  insert into private.operator_greeting_events(user_id,session_id,kind,body)
    values(new.auth_id,v_session,'registration',private.render_operator_greeting(
      new.auth_id,v_config.registration_named_body,v_config.registration_body))
    on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.queue_operator_registration_greeting() from public, anon, authenticated;
create trigger queue_operator_registration_greeting
  after insert on public.account_holders for each row
  execute function private.queue_operator_registration_greeting();

create function private.deliver_my_operator_greetings(
  p_expected_user uuid, p_expected_session uuid, p_record_login boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_session uuid := nullif(auth.jwt()->>'session_id','')::uuid;
  v_started timestamptz;
  v_config private.operator_greeting_config;
  v_event private.operator_greeting_events;
  v_message uuid;
  v_sent integer := 0;
begin
  -- Captured identities prevent a late result from account A greeting account B.
  if v_user is null or v_user is distinct from p_expected_user
    or v_session is null or v_session is distinct from p_expected_session then
    return jsonb_build_object('status','stale','sent',0);
  end if;
  -- Hold user/session existence stable against moderation/deletion/sign-out.
  perform u.id from auth.users u where u.id = v_user for share;
  if not found or public.is_account_moderated(v_user) or not exists (
    select 1 from auth.users u where u.id = v_user and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
  ) then return jsonb_build_object('status','stale','sent',0); end if;
  select s.created_at into v_started from auth.sessions s
    where s.id = v_session and s.user_id = v_user for key share;
  if not found then return jsonb_build_object('status','stale','sent',0); end if;
  select * into v_config from private.operator_greeting_config where singleton for share;
  if not coalesce(v_config.enabled,false) then
    return jsonb_build_object('status','disabled','sent',0);
  end if;
  -- Serializes concurrent devices/tabs and uses the same row as registration.
  perform a.id from public.account_holders a where a.auth_id = v_user for no key update;
  if not found then return jsonb_build_object('status','registration_pending','sent',0); end if;
  if p_record_login then
    -- Pre-activation sessions are never retroactively counted as new logins.
    if v_started is null or v_started < v_config.enabled_at then
      return jsonb_build_object('status','stale','sent',0);
    end if;
    insert into private.operator_greeting_events(user_id,session_id,kind,body)
      values(v_user,v_session,'login',private.render_operator_greeting(
        v_user,v_config.login_named_body,v_config.login_body))
      on conflict do nothing;
  end if;
  -- Restores/online retries can drain already-recorded events but cannot create a
  -- new login. Chat+receipt are atomic, even after an unknown response. Keep the
  -- already recorded event if downstream delivery fails, so another valid
  -- session can retry it without relying on the originating browser's marker.
  begin
    for v_event in
      select * from private.operator_greeting_events e
        where e.user_id = v_user and e.message_id is null and e.created_at >= v_config.enabled_at
        order by e.created_at,e.id limit 20 for update
    loop
      v_message := gen_random_uuid();
      update private.operator_greeting_events set message_id = v_message where id = v_event.id;
      insert into public.admin_messages(id,user_id,from_admin,body)
        values(v_message,v_user,true,v_event.body);
      v_sent := v_sent + 1;
    end loop;
  exception when others then
    return jsonb_build_object('status','retry','sent',0);
  end;
  return jsonb_build_object('status',case
    when exists (select 1 from private.operator_greeting_events e where e.user_id=v_user
      and e.message_id is null and e.created_at>=v_config.enabled_at) then 'retry'
    when v_sent > 0 then 'delivered' else 'idle' end,'sent',v_sent);
end;
$$;
revoke all on function private.deliver_my_operator_greetings(uuid,uuid,boolean) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.deliver_my_operator_greetings(uuid,uuid,boolean) to authenticated;

-- The Data API wrapper has no elevated privileges and accepts no body/recipient.
create function public.deliver_my_operator_greetings(
  p_expected_user uuid, p_expected_session uuid, p_record_login boolean default false
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.deliver_my_operator_greetings(p_expected_user,p_expected_session,p_record_login);
$$;
revoke all on function public.deliver_my_operator_greetings(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.deliver_my_operator_greetings(uuid,uuid,boolean) to authenticated;
commit;
