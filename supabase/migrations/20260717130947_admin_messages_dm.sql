-- 運営ダイレクトメッセージ（2026-07-16）：運営⇄利用者の1対1スレッド。
-- 職安法整理：運営からの事務連絡・本人への通知であり、特定求職者の推薦・売り込みには使わない（地雷リスト遵守は運用側）
create table public.admin_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,           -- 利用者側の当事者（auth.users.id）
  from_admin boolean not null,     -- true=運営からの送信／false=利用者の返信
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz              -- 受け手が読んだ時刻（運営宛は運用上未使用でも可）
);

alter table public.admin_messages enable row level security;

-- 閲覧：本人のスレ or 管理者
create policy "am select" on public.admin_messages
  for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));

-- 送信：利用者は自分のスレに返信（from_admin=false）のみ／管理者はfrom_admin=trueで任意の利用者へ
create policy "am insert" on public.admin_messages
  for insert to authenticated
  with check (
    (user_id = auth.uid() and from_admin = false)
    or (from_admin = true and exists (select 1 from public.app_admins a where a.auth_id = auth.uid()))
  );

-- 既読化：本人 or 管理者
create policy "am update" on public.admin_messages
  for update to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.app_admins a where a.auth_id = auth.uid()))
  with check (user_id = auth.uid() or exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));

create index idx_admin_messages_user on public.admin_messages(user_id, created_at desc);