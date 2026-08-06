-- job-photos の書き込みを本人フォルダに限定（2026-08-06 実機一周②の新発見1の修理）
-- 旧：INSERT/UPDATE/DELETE とも qual が bucket_id のみ＝authenticated全員がバケット全体に
-- 書けた（ログインした誰でも他人の求人写真・危険箇所写真・サムネを削除/差し替え可能）。
-- 新：本人フォルダ（{auth.uid()}/…）のみ＋管理者(app_admins)は全域（サムネ後埋め・一括軽量化
-- の管理ツールが既存ルート直下ファイルへupsertするため）。
-- 既存のルート直下ファイルは移動しない＝非管理者からは不可侵になる（記録保全はむしろ強化）。
-- 読み取り（"job-photos authenticated read"・公開URL）は不変。avatarsの本人フォルダ方式と同型。
-- フロント側：lib/image.js uploadJobPhoto が新規アップロードを {auth.uid()}/ 配下に保存する（同日変更）。
-- 検証済み（ロールバック付き実弾）：一般→他人領域INSERT拒否／本人フォルダINSERT通過／
-- 一般→既存ルートUPDATE 0行／管理者→既存ルートUPDATE可／anon INSERT拒否。

drop policy if exists "job-photos authenticated insert" on storage.objects;
drop policy if exists "job-photos authenticated update" on storage.objects;
drop policy if exists "job-photos authenticated delete" on storage.objects;

create policy "job-photos owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'job-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "job-photos owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'job-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'job-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "job-photos owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'job-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "job-photos admin write" on storage.objects
  for all to authenticated
  using (bucket_id = 'job-photos'
         and exists (select 1 from public.app_admins a where a.auth_id = auth.uid()))
  with check (bucket_id = 'job-photos'
              and exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));
