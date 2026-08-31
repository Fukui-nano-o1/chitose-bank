-- 農タイムレスを委託レーンから独立させる（2026-08-31たきと指示「委託の要素は全て削除。これは新しいプロジェクト」）。
-- 写真の置き場を consignment-photos の間借りから専用バケット farm-timeless へ。
-- バケット新設は4枚セット（select/insert/update/delete）＝2026-08-02の教訓
-- （publicバケットでも storage API の download/list には SELECT ポリシーが要る）。
-- 書き込みは app_admins のみ＝farm_timeless_posts のRLSと同じ壁。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('farm-timeless', 'farm-timeless', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "farm-timeless authenticated read" on storage.objects
  for select to authenticated using (bucket_id = 'farm-timeless');
create policy "farm-timeless admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'farm-timeless' and exists (select 1 from app_admins a where a.auth_id = auth.uid()));
create policy "farm-timeless admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'farm-timeless' and exists (select 1 from app_admins a where a.auth_id = auth.uid()))
  with check (bucket_id = 'farm-timeless' and exists (select 1 from app_admins a where a.auth_id = auth.uid()));
create policy "farm-timeless admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'farm-timeless' and exists (select 1 from app_admins a where a.auth_id = auth.uid()));
