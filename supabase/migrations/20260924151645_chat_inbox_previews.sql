-- One latest preview per permitted conversation. Never return another participant's inbox.
-- Invoker privileges preserve existing application/message RLS and moderation restrictions.
create index if not exists idx_messages_thread_latest
  on public.messages(application_id, created_at desc, id desc);

create or replace function public.my_chat_inbox_previews()
returns table (id uuid, application_id uuid, sender_id uuid, body text, created_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select m.id, a.id, m.sender_id, left(m.body, 240), m.created_at
  from public.applications a
  cross join lateral (
    select msg.id, msg.sender_id, msg.body, msg.created_at
    from public.messages msg
    where msg.application_id = a.id
    order by msg.created_at desc, msg.id desc
    limit 1
  ) m
  where a.worker_id = (select auth.uid()) or a.farmer_id = (select auth.uid());
$$;
revoke all on function public.my_chat_inbox_previews() from public, anon;
grant execute on function public.my_chat_inbox_previews() to authenticated;
comment on function public.my_chat_inbox_previews() is 'Participant inbox previews, one latest message per application; existing RLS remains authoritative.';
