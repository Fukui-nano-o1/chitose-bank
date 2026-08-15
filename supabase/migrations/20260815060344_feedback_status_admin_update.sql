-- 画面の報告（feedback）に対応状況を追加（2026-08-15 報告の集計一本化・#/admin/reports）
-- 背景：feedbackは4つの報告台帳のうち唯一status列が無く、運営が「対応済み」を記録できなかった
-- （そもそも運営UIも無かった＝送れるのに見る場所が無い）。統合報告ページで他の3台帳
-- （job_reports/message_reports/profile_reports）と同じ扱いにするため、同じ形のstatusと
-- 管理者UPDATEポリシーを足す。既存行はすべて'open'（未対応）扱い＝行の削除・改変はしない。
alter table public.feedback add column if not exists status text not null default 'open';
do $$ begin
  alter table public.feedback add constraint feedback_status_check check (status in ('open','resolved'));
exception when duplicate_object then null; end $$;
drop policy if exists "fb update admin" on public.feedback;
create policy "fb update admin" on public.feedback for update
  using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()))
  with check (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));
