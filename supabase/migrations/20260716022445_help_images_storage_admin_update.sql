-- help-imagesバケット：upsert(上書き)アップロードに必要なUPDATEポリシー（管理者のみ）
-- 既存: help img read(SELECT/public), help img admin write(INSERT/admin), help img admin delete(DELETE/admin)
create policy "help img admin update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'help-images'
    and exists (select 1 from app_admins a where a.auth_id = auth.uid())
  )
  with check (
    bucket_id = 'help-images'
    and exists (select 1 from app_admins a where a.auth_id = auth.uid())
  );