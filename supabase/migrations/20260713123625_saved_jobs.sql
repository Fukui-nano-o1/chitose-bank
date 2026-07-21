-- 求人のお気に入り（いいね・保存）
create table if not exists public.saved_jobs (
  worker_id uuid not null,
  job_number int not null,
  created_at timestamptz not null default now(),
  primary key (worker_id, job_number)
);

alter table public.saved_jobs enable row level security;

-- 本人のみ：自分の保存を作成・削除・閲覧
create policy "saved insert own" on public.saved_jobs
  for insert to authenticated with check (worker_id = auth.uid());
create policy "saved delete own" on public.saved_jobs
  for delete to authenticated using (worker_id = auth.uid());
create policy "saved select own" on public.saved_jobs
  for select to authenticated using (worker_id = auth.uid());