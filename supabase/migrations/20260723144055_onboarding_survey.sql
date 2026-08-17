-- きっかけアンケート（初回いいね時・2026-07-23）。※本番へ先行適用済み（version 20260723144055）。
--   repo とのズレを解消するための写経（二頭運転の交通規則）。冪等形ので再適用も安全。
-- 未回答ユーザーの最初のいいねの前に1度だけ聞く：source=どこで知ったか（単一）、reasons=どう使いたいか（複数）。
-- 本人のみinsert/select（既回答判定）。運営はselectで集計（📊きっかけ）。応募・Q&A・チャットには絶対にゲートを置かない。
create table if not exists public.user_onboarding_survey (
  auth_id uuid primary key,
  source text,
  source_other text,
  reasons jsonb,
  reason_other text,
  created_at timestamptz not null default now()
);

alter table public.user_onboarding_survey enable row level security;

drop policy if exists "survey own insert" on public.user_onboarding_survey;
create policy "survey own insert" on public.user_onboarding_survey
  for insert to authenticated with check (auth_id = auth.uid());

drop policy if exists "survey own select" on public.user_onboarding_survey;
create policy "survey own select" on public.user_onboarding_survey
  for select to authenticated using (auth_id = auth.uid());

drop policy if exists "survey admin select" on public.user_onboarding_survey;
create policy "survey admin select" on public.user_onboarding_survey
  for select to authenticated using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));
