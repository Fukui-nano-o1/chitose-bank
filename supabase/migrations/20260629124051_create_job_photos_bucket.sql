-- job-photos バケット（求人写真・危険箇所写真）。jobsテーブルは既存ので触らない
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', true, 5242880, array['image/jpeg','image/png','image/webp']);

-- アップロード・更新・削除は認証済みユーザーのみ（閲覧はpublicバケットので自動公開）
create policy "job-photos authenticated insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'job-photos');

create policy "job-photos authenticated update"
on storage.objects for update to authenticated
using (bucket_id = 'job-photos') with check (bucket_id = 'job-photos');

create policy "job-photos authenticated delete"
on storage.objects for delete to authenticated
using (bucket_id = 'job-photos');