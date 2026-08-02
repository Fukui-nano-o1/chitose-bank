-- job-photos バケットにSELECTポリシーが無く、storage APIの download/list（認証エンドポイント）が
-- RLSで全拒否されていた（公開URL /object/public/ の閲覧はバケットのpublic設定で可＝画面表示は無事）。
-- これにより管理ツール（カード用サムネ生成 generateJobPhotoThumbs・画像一括軽量化 recompressBucket）の
-- download/list が job-photos で全滅していた（2026-08-02 サムネ後埋め70枚失敗の原因）。
-- publicバケットなので情報の公開範囲は変わらない（公開URLで誰でも読める前提のバケット）。
create policy "job-photos authenticated read" on storage.objects
  for select to authenticated
  using (bucket_id = 'job-photos');
