-- 【写経同期】DB履歴（version 20260806173837・name 20260806181500_job_photos_owner_scoped_write）に
-- あってrepoに無かった1本（2026-08-07 実機一周④で発見・2026-07-21規則4に基づき同期）。
-- 実体＝並走セッションによる job-photos 本人フォルダ化の重複適用。
-- 最終状態は 20260806171724_job_photos_owner_scope.sql と同一であることを pg_policy の現物で照合済み
-- （owner insert/update/delete＝本人フォルダ限定＋admin write＝app_adminsは全域＋authenticated read）。
-- 内容は現物ポリシーからの転記＝再適用しても同じ状態に収束する（drop if exists→create）。

drop policy if exists "job-photos owner insert" on storage.objects;
drop policy if exists "job-photos owner update" on storage.objects;
drop policy if exists "job-photos owner delete" on storage.objects;
drop policy if exists "job-photos admin write" on storage.objects;

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
