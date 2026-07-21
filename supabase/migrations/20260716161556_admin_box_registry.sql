-- ボックス一覧の台帳をDB化（2026-07-16）：管理画面から追加・編集・削除できるようにする
-- 保存機能ルール準拠：管理者専用（app_admins）をRLSで担保。一般ユーザーは読み書きとも不可
create table public.admin_box_registry (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  where_from text not null default '',
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.admin_box_registry enable row level security;

create policy "box registry admin all" on public.admin_box_registry
  for all to authenticated
  using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()))
  with check (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));

-- 現在ハードコードされている13行を初期投入
insert into public.admin_box_registry (name, where_from, sort) values
  ('求人プレビュー',     '農家プロ｜作成中・公開中・期限切れのカードをタップ', 1),
  ('応募カード',         '働き手プロ｜チェックのカードをタップ', 2),
  ('応募者詳細',         '農家プロ｜応募者のカードをタップ', 3),
  ('また呼びたい詳細',   '農家プロ入口｜リストのアイコンをタップ', 4),
  ('農園紹介',           '求人詳細・確認ページ｜農家プロフィールをタップ', 5),
  ('過去の求人',         '農園紹介内｜受入実績をタップ', 6),
  ('掲載チェックリスト', '確認ページ｜掲載するをタップ', 7),
  ('評価登録完了',       '評価送信の直後', 8),
  ('おかえりなさい',     'プロフィール承認時（リアルタイム）', 9),
  ('働き手プレビュー',   '働き手プロ編集｜プレビューをタップ', 10),
  ('農家プレビュー',     '農家プロ編集｜プレビューをタップ', 11),
  ('カレンダー（詳細）', '求人詳細｜浮遊📅をタップ', 12),
  ('管理・その他5種',    '管理画面その他｜主要ページ／求人フロー／旧事業データ／システム／ボックス一覧', 13);