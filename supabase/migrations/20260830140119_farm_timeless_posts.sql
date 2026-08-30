-- 農タイムレス（2026-08-30たきと指示）：日本地図（都道府県タイル）に病害虫・栽培アクションを
-- 写真と一言コメントで記録する、運営専用の圃場ノート。
-- 管理者専用＝閲覧・書き込みとも app_admins のみ（委託レーン consignment_deals と同じ型）。
-- 写真は consignment-photos バケット（書き込み=admin限定・公開URL）を timeless_ プレフィックスで間借り＝
-- 新しいバケット・新しいストレージポリシーは作らない。
create table if not exists public.farm_timeless_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_id uuid not null default auth.uid(),
  kind text not null check (kind in ('pest','action')),          -- pest=病害虫 / action=栽培アクション
  category text not null check (char_length(btrim(category)) between 1 and 40), -- 病害虫の種類 or 作業名
  pref text not null check (char_length(btrim(pref)) between 2 and 4),          -- 都道府県名（例：徳島県）
  comment text not null default '' check (char_length(comment) <= 300),         -- 一言コメント
  photo_url text                                                  -- 任意（consignment-photos の公開URL）
);

alter table public.farm_timeless_posts enable row level security;

-- 管理者のみ全操作。anonはポリシー無し＝全拒否
create policy "farm_timeless admin all" on public.farm_timeless_posts
  for all to authenticated
  using (exists (select 1 from app_admins a where a.auth_id = auth.uid()))
  with check (exists (select 1 from app_admins a where a.auth_id = auth.uid()));
