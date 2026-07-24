-- 招待制解除の1点ゲート化（2026-07-24たきと指示・今晩から本番）。
-- am_i_account_allowed() に signup_open() を組み込む：app_settings.signup_open='true' なら誰でも登録可、
-- 'false' に戻せば即・招待リスト（account_allowlist）のみ＝キルスイッチ。
-- RLS（account_holders own_insert）とフロントの isAllowed 判定は両方この関数を見ているので、
-- サーバー・画面が1行の設定で同時に切り替わる。
-- 前提充足：2026-07-21 規約v2/プラポリv2本番実装（CLAUDE.md「以後signup_openの操作は運営判断」）。
-- ※third_party_publish_allowed は別ゲートのまま false（受理通知書到着まで第三者求人の公開は機構的に不可）。
-- ※signup_open='true' への切替は運用データ（execute_sqlで2026-07-24実施）。本ファイルは関数定義のみ。
create or replace function public.am_i_account_allowed()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.signup_open()
      or exists (
        select 1 from public.account_allowlist
         where email = (auth.jwt() ->> 'email')
      );
$function$;
