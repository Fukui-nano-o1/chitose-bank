-- consignment-photos バケットに SELECT ポリシーを追加（2026-08-06 実機一周②の検出）
--
-- 【何が問題か】consignment-photos は insert/update/delete の3枚だけで SELECT ポリシーが無い。
-- job-photos で踏んだのと同型の穴（2026-08-02続3）：public バケットなので画面表示
-- （公開URL /object/public/）は無事だが、storage API の download()/list()（認証エンドポイント）は
-- RLSで全拒否＝再圧縮・一括処理などツール類がこのバケットに対して全滅する。
-- 【教訓（2026-08-02制定）】publicバケット＝「読める」ではない。バケット新設時は read 含む
-- 4枚セットで作ること。本件はその教訓の適用漏れ（consignment-photos は3枚で新設されていた）。
-- 【公開範囲】public バケットので公開範囲は不変（誰でも公開URLで見られる状態は前からそのまま）。
create policy "consignment-photos authenticated read"
  on storage.objects for select to authenticated
  using (bucket_id = 'consignment-photos');
