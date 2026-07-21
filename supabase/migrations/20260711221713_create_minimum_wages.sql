-- 都道府県別・地域別最低賃金（年1回・手動更新）
-- 定数ハードコード禁止。発効日で履歴管理し、過去分も残す。
create table if not exists public.minimum_wages (
  id uuid primary key default gen_random_uuid(),
  prefecture text not null,
  hourly_wage integer not null check (hourly_wage > 0),
  effective_from date not null,
  source_url text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prefecture, effective_from)
);

create index if not exists idx_minimum_wages_lookup
  on public.minimum_wages (prefecture, effective_from desc);

alter table public.minimum_wages enable row level security;

-- 読み取りは全員に許可（未ログイン訪問者も求人閲覧時に検証が要る）
create policy "minimum_wages_select_all"
  on public.minimum_wages for select
  to anon, authenticated
  using (true);

-- 書き込みポリシーは意図的に作らない。
-- 年1回の更新はダッシュボード（service_role）からのみ行う。
-- これによりアプリ経由での改ざんが構造的に不可能になる。

-- 機能集約（設計原則②）：最低賃金の取得は必ずこの関数を通す。
-- 発効日 <= 今日 の中で最新の1件を返す。該当なしは null。
create or replace function public.get_minimum_wage(p_prefecture text)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select hourly_wage
  from public.minimum_wages
  where prefecture = p_prefecture
    and effective_from <= current_date
  order by effective_from desc
  limit 1;
$$;