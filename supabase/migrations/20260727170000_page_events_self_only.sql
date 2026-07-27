-- 行動計測は運営者本人の自己デバッグに限る（2026-07-27たきと指示）
-- 発端：協力者（第三者）の閲覧軌跡が page_events に記録され、要約メールで運営に届いていた。
-- データ憲法・行動記録の憲法「個人の閲覧・検索行動は記録しない（データ最小化）」に反するため即時停止。
-- ①INSERTを app_admins（運営者本人のログイン）に限定：画面の実装に関わらずDBが拒む
-- ②summarize_sessions の対象を反転：従来「管理者を除く全員」→「運営者本人のみ」
-- ③既に溜まっていた第三者の行は削除済み（sathaaaannn 371件／hmktsr15231 101件／wuren9042 39件）
drop policy if exists "pe insert own" on public.page_events;
drop policy if exists "pe insert self admin only" on public.page_events;
create policy "pe insert self admin only" on public.page_events
  for insert to authenticated
  with check (auth_id = auth.uid()
              and exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));

delete from public.page_events e
 where not exists (select 1 from public.app_admins a where a.auth_id = e.auth_id)
   and e.auth_id not in (select id from auth.users where email = 't5fki6643qty+test@gmail.com');
