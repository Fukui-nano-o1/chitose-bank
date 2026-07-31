-- 退会申し出の記録（プラポリv3・第7条1「退会のお申し出から30日以内に、本人確認情報とプロフィールを削除します」の起点）
-- 行動記録の憲法・柱1：退会ボタン＝意思表示のアクションに時刻の記録を持たせる。
-- 削除の実行は運営（たきと）の手動作業＝管理タブの未対応一覧が着手の導線。自動削除は将来の別タスク。
create table if not exists public.withdrawal_requests (
  id           uuid primary key default gen_random_uuid(),
  auth_id      uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  processed_at timestamptz
);

comment on table  public.withdrawal_requests is '退会申し出の記録。requested_at+30日が削除期限（プラポリv3第7条1）';
comment on column public.withdrawal_requests.processed_at is '運営が削除対応を完了した時刻。null=未対応';

alter table public.withdrawal_requests enable row level security;

-- 本人のみ申請できる（auth_idの成りすまし不可）
create policy "wr self insert" on public.withdrawal_requests
  for insert to authenticated
  with check (auth.uid() = auth_id);

-- 本人と管理者のみ読める
create policy "wr self or admin select" on public.withdrawal_requests
  for select to authenticated
  using (
    auth.uid() = auth_id
    or exists (select 1 from public.app_admins a where a.auth_id = auth.uid())
  );

-- 対応済みの記録（processed_at）は管理者のみ書ける
create policy "wr admin update" on public.withdrawal_requests
  for update to authenticated
  using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()))
  with check (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));
