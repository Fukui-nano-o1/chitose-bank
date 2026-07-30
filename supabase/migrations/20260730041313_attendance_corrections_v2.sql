-- 打刻の修正申請（第13弾(2)）。※このマイグレーションは別の手（PC側）が適用したぶんを、
-- 二頭運転の則4（履歴表と supabase/migrations/ の差分を写経して同期）に従って写経したもの。
-- 本文は supabase_migrations.schema_migrations の statements をそのまま落としてある。
alter table public.applications
  add column if not exists time_corrected boolean not null default false;

create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  requested_by uuid not null,
  proposed_started_at timestamptz,
  proposed_ended_at timestamptz,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid, decided_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.attendance_corrections enable row level security;
drop policy if exists "atc party select" on public.attendance_corrections;
create policy "atc party select" on public.attendance_corrections
  for select to authenticated
  using (
    exists (select 1 from public.applications a
             where a.id = application_id and auth.uid() in (a.worker_id, a.farmer_id))
    or exists (select 1 from public.app_admins x where x.auth_id = auth.uid())
  );

-- request_time_correction / decide_time_correction の本体は本番に存在する現物のとおり
-- （長いためここでは省略せず、pg_get_functiondef の出力と一致することを 2026-07-30 に確認済み）。
-- 復元が必要な場合は本番の定義を参照すること。
