-- 委託圃場の登録（2026-08-02たきと指示）：プロフィールのスワイプ2枚目で登録・管理し、
-- 新規委託ウィザードSTEP1で呼び出す。ウィザードで入力した圃場も掲載時に自動登録（同名はupsert）。
-- 管理者限定レーン＝consignment_profiles と同じ app_admins ゲート
create table if not exists public.consignment_fields (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid not null,
  name text not null,           -- 圃場の呼び名（auth_id内で一意＝同名upsertの鍵）
  region text not null default '',
  area_a text not null default '',
  data jsonb not null default '{}',  -- facility_parking/toilet/rest/lend など可変項目（追加可能・削除可能）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_id, name)
);
alter table public.consignment_fields enable row level security;
drop policy if exists "consignment_fields admin all" on public.consignment_fields;
create policy "consignment_fields admin all" on public.consignment_fields
  for all to authenticated
  using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()))
  with check (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));
revoke all on public.consignment_fields from anon;
