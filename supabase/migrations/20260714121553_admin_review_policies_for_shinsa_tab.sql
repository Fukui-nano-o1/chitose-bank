-- 審査タブ集約（2026-07-14）：管理者(app_admins)の審査権限を追加
-- 1) 農家アカウント承認：管理者がstatusを更新できる（承認ボタン用）
create policy "farmers admin update" on public.farmers
  for update using (exists (select 1 from app_admins a where a.auth_id = auth.uid()))
  with check (exists (select 1 from app_admins a where a.auth_id = auth.uid()));
-- 2) 働き手プロフィール自由記述の確認：管理者が読める・公開反映できる
create policy "wp admin select" on public.worker_profiles
  for select using (exists (select 1 from app_admins a where a.auth_id = auth.uid()));
create policy "wp admin update" on public.worker_profiles
  for update using (exists (select 1 from app_admins a where a.auth_id = auth.uid()))
  with check (exists (select 1 from app_admins a where a.auth_id = auth.uid()));
-- 3) 欠勤異議：管理者が読める
create policy "att admin select" on public.attendance_events
  for select using (exists (select 1 from app_admins a where a.auth_id = auth.uid()));
-- 4) 通報の対応済み処理：管理者がstatusを更新できる
create policy "report admin update" on public.job_reports
  for update using (exists (select 1 from app_admins a where a.auth_id = auth.uid()))
  with check (exists (select 1 from app_admins a where a.auth_id = auth.uid()));