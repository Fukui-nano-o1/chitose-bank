-- 雇い手の公開プロフィール。worker_profilesと列は対称、RLSは非対称(全公開SELECT)。
create table if not exists public.employer_profiles (
  auth_id    uuid primary key,
  nickname   text,
  pr         text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employer_profiles enable row level security;

-- SELECT: 誰でも読める(公開・求人を見る働き手/訪問者が雇い手を確認できる)
create policy "ep public select"
  on public.employer_profiles for select
  using (true);

-- INSERT: 本人のみ
create policy "ep owner insert"
  on public.employer_profiles for insert
  with check (auth_id = auth.uid());

-- UPDATE: 本人のみ
create policy "ep owner update"
  on public.employer_profiles for update
  using (auth_id = auth.uid());

-- updated_at 自動更新
create or replace function public.set_employer_profiles_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger trg_employer_profiles_updated_at
  before update on public.employer_profiles
  for each row execute function public.set_employer_profiles_updated_at();