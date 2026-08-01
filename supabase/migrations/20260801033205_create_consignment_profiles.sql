-- 委託専用プロフィール（雇い手プロフィールと同じ項目・別テーブル・2026-07-31たきと指示）。
-- employer_profiles の列・既定・NOT NULL/CHECK をそのまま複製（LIKE）。PKは auth_id（upsert onConflict用）。
create table if not exists public.consignment_profiles (
  like public.employer_profiles including defaults including constraints
);
alter table public.consignment_profiles add primary key (auth_id);

-- 委託は管理者専用レーン（consignment_deals と同型）：app_admins のみ全操作可
alter table public.consignment_profiles enable row level security;
create policy "consignment_profiles admin all" on public.consignment_profiles
  for all to authenticated
  using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()))
  with check (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));
