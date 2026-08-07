-- 閲覧された回数のリアルタイム表示（2026-08-07たきと指示「リアルタイムで計測、表示」）。
-- Realtime(postgres_changes)は RLS を尊重するため、本人・運営だけの SELECT ポリシーを追加した上で
-- supabase_realtime パブリケーションに登録する（messages のチャットライブと同じ作法）。
-- ★書き込み系ポリシーは引き続き置かない＝+1の窓口は count_worker_profile_view のみ（変更なし）。
-- ★農家・第三者には行が見えない＝購読しても何も届かない（RLSが遮断・従来の開示範囲は不変）。
-- 実測：本人select=1行／農家select=0行／農家update=拒否／publication登録=1。
drop policy if exists "wpvc self select" on public.worker_profile_view_counts;
create policy "wpvc self select" on public.worker_profile_view_counts
  for select to authenticated
  using (worker_id = auth.uid() or exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));
grant select on public.worker_profile_view_counts to authenticated;

alter publication supabase_realtime add table public.worker_profile_view_counts;
