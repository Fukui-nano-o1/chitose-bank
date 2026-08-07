-- 閲覧された回数（2026-08-07たきと裁定：匿名カウンター・表示は本人と運営のみ）。
-- ★行動記録の憲法「個人の閲覧・検索行動は記録しない」を守る設計＝誰が見たかは一切保存しない。
--   保存するのは働き手ごとの合計回数だけ（viewer_id・時刻の明細行を持たない）。
-- ★数えるのは「その働き手から応募を受けた農家」の閲覧のみ（worker_work_recordと同じ関係ゲート）
--   ＝無関係のユーザーがRPCを連打しても数字は動かない（水増し防止）。本人・運営の閲覧も数えない。
create table if not exists public.worker_profile_view_counts (
  worker_id uuid primary key,
  view_count bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.worker_profile_view_counts enable row level security;
-- ポリシーは置かない＝クライアントからの直接read/writeは全拒否。窓口は下のSECURITY DEFINER関数のみ
revoke all on public.worker_profile_view_counts from anon, authenticated;

create or replace function public.count_worker_profile_view(p_worker_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null or p_worker_id is null then return; end if;
  if auth.uid() = p_worker_id then return; end if; -- 本人は数えない
  if exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then return; end if; -- 運営は数えない
  -- 応募関係のある農家だけ数える（関係ゲート＝worker_work_recordと同じ相手）
  if not exists (
    select 1 from public.applications a
    where a.worker_id = p_worker_id and a.farmer_id = auth.uid()
  ) then return; end if;
  insert into public.worker_profile_view_counts (worker_id, view_count, updated_at)
       values (p_worker_id, 1, now())
  on conflict (worker_id) do update
    set view_count = public.worker_profile_view_counts.view_count + 1, updated_at = now();
end $$;
revoke all on function public.count_worker_profile_view(uuid) from public, anon;
grant execute on function public.count_worker_profile_view(uuid) to authenticated;

-- 実測（ロールバック付き・本番で確認済み）：関係農家2回=+2／本人・無関係・anon=数えない／
-- テーブル直接select=拒否
