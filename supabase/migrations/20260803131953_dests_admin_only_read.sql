-- dests（旧事業データ＝出荷先）の全開放READを管理者限定にする（2026-08-03・訪問者モザイクの監査で発見）。
-- RLSは有効だが SELECT だけ dests_public_read（qual=true）で anon にも全開放されており、
-- submitted_by に運営者の実名が入った行が未ログインの誰にでも読めていた（anonロールでの実測で確認）。
-- 読み手は管理タブ（AdminTab の旧事業データ表示）のみ＝管理者限定にしても機能は壊れない。
-- INSERT/UPDATE/DELETE のポリシーは既に絞られているため触らない。
drop policy if exists dests_public_read on public.dests;
create policy "dests admin read" on public.dests
  for select to authenticated
  using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));
