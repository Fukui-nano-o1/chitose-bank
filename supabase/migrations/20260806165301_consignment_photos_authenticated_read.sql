-- consignment-photos バケットに SELECT ポリシーを追加（2026-08-06）
-- ※DB直接適用済み（schema_migrations 20260806165301・name=20260806174500_consignment_photos_authenticated_read）の写経。
-- job-photos で踏んだ穴（2026-08-02続3：publicバケットでも storage API の download/list には
-- SELECTポリシーthat要る）と同型の予防。公開範囲は不変。

create policy "consignment-photos authenticated read"
  on storage.objects for select to authenticated
  using (bucket_id = 'consignment-photos');
