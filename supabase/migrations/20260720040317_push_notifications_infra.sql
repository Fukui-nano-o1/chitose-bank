-- チャットのプッシュ通知基盤（2026-07-19）：Web Push（内容は出さない「新しいメッセージが届きました」）
-- 購読テーブル（端末ごと・1ユーザー複数端末可）
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  auth_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_sub_auth on public.push_subscriptions(auth_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push own manage" on public.push_subscriptions;
create policy "push own manage" on public.push_subscriptions for all
  using (auth_id = auth.uid()) with check (auth_id = auth.uid());

-- VAPID鍵・件名・トリガー秘密（service role/postgresのみ。RLSポリシー無し＝一般は読めない）
create table if not exists public.push_config (
  id int primary key default 1,
  vapid_public text not null,
  vapid_private text not null,
  subject text not null default 'mailto:t5fki6643qty@gmail.com',
  trigger_secret text not null
);
alter table public.push_config enable row level security;
insert into public.push_config (id, vapid_public, vapid_private, trigger_secret)
values (1,
  'BEQQLtNHOdMop2EELSEQJpb1QXVHhRhi3nLwaQFBsRTobpLbQCcjmpWC5vfnQpGh5VZIw9fOOh89CmvvmcRmU-g',
  '5wdY8jXJJSbJVJ3-HOOdzkKZyVmPEtNSIdV0J3prQt8',
  '4tW0aN9kKyFaFJlBbIALcOelWIeqxYTO')
on conflict (id) do nothing;

-- 自分の購読を登録/更新（フロントから呼ぶ・本人のみ）
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  insert into public.push_subscriptions (endpoint, auth_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set auth_id = excluded.auth_id, p256dh = excluded.p256dh, auth = excluded.auth;
  return json_build_object('ok', true);
end; $$;

-- VAPID公開鍵をフロントへ渡す（購読時にapplicationServerKeyとして使う・公開情報）
create or replace function public.push_vapid_public()
returns text language sql security definer set search_path to 'public' stable as $$
  select vapid_public from public.push_config where id = 1;
$$;
grant execute on function public.push_vapid_public() to authenticated;