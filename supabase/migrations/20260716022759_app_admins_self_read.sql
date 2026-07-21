-- app_admins: RLS有効なのにポリシー0枚だったため、これを参照する全ポリシーの
-- exists(select 1 from app_admins where auth_id=auth.uid()) が常にfalseになっていた。
-- 本人行のみSELECT可を追加（管理者は自分の行が見える→existsがtrueに。非管理者は0行のまま）
create policy "app_admins self read" on public.app_admins
  for select to authenticated
  using (auth_id = auth.uid());