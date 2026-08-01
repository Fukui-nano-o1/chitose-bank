-- consignment-photos バケット（委託掲載の写真）。委託は管理者専用レーンのため
-- 書き込みは app_admins 限定・閲覧は public（掲載写真so公開でよい）。job-photos の作法に準拠。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('consignment-photos', 'consignment-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "consignment-photos admin insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'consignment-photos' and exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));

create policy "consignment-photos admin update"
on storage.objects for update to authenticated
using (bucket_id = 'consignment-photos' and exists (select 1 from public.app_admins a where a.auth_id = auth.uid()))
with check (bucket_id = 'consignment-photos' and exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));

create policy "consignment-photos admin delete"
on storage.objects for delete to authenticated
using (bucket_id = 'consignment-photos' and exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));
