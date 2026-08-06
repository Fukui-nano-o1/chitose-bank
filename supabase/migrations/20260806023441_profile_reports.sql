-- 働き手プレビューからの通報の受け皿（2026-08-06たきと指示「プレビューに報告するを2つ」）。
-- 既存の job_reports（求人）・message_reports（チャット本文）と同型の三本目。
-- ★行動記録の憲法：報告は追記のみの台帳。当事者は消せない（DELETEポリシーを置かない）。
-- ★運営の主観は混ぜない：選択肢は事実の申告のみ。点数・おすすめ度の類は持たない（2026-07-16あっせん回避）。
create table if not exists public.profile_reports (
  id uuid primary key default gen_random_uuid(),
  -- 報告された相手（働き手の auth_id ＝ プレビューが受け取る workerId と同じ値）
  target_worker_id uuid not null,
  reporter_id uuid not null,
  -- どちらの面から報告したか（プレビューの2ページに対応）。運営が「何についての報告か」を取り違えないための列
  source text not null check (source in ('profile', 'work_record')),
  target_field text not null,
  issue_type text not null,
  detail text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  -- 自分自身は報告できない
  constraint profile_reports_not_self check (target_worker_id <> reporter_id)
);

create index if not exists profile_reports_target_idx on public.profile_reports (target_worker_id, created_at desc);

alter table public.profile_reports enable row level security;

-- 報告する側：ログイン済みが、自分名義でのみ入れられる（job_reports の "report insert own" と同型）
drop policy if exists "pr insert own" on public.profile_reports;
create policy "pr insert own" on public.profile_reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

-- 読めるのは運営だけ（報告された本人にも見せない＝報告者が特定されない・通報の匿名性）
drop policy if exists "pr select admin" on public.profile_reports;
create policy "pr select admin" on public.profile_reports
  for select to authenticated
  using (exists (select 1 from app_admins a where a.auth_id = auth.uid()));

-- 対応済みにできるのは運営だけ
drop policy if exists "pr admin update" on public.profile_reports;
create policy "pr admin update" on public.profile_reports
  for update to authenticated
  using (exists (select 1 from app_admins a where a.auth_id = auth.uid()))
  with check (exists (select 1 from app_admins a where a.auth_id = auth.uid()));

revoke all on public.profile_reports from anon;
grant select, insert, update on public.profile_reports to authenticated;

-- 実測（ロールバック付きDOブロック・本番で確認済み）：
--   1) anon insert=DENIED / 2) 本人名義 insert=OK / 3) 他人名義 insert=DENIED
--   4) 一般ユーザーの select=0件 / 5) 自分を報告=DENIED / 6) 未知のsource=DENIED / 7) 運営の select=1件
