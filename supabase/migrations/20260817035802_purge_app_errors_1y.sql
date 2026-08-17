-- エラーの記録（app_errors）の保存期間＝取得から1年（2026-08-16たきと指示）。
-- プライバシーポリシー第3条データ台帳に「エラーの記録」の行を追記したことに対応する削除機構。
-- 保存・削除の設計台帳v1の原則どおり：
--   原則1＝台帳の約束の履行としてのみ削除する（台帳に無い削除は作らない／約束したら機構を必ず置く）
--   原則2＝1目的1関数。対象テーブルと期限をハードコード。SECURITY DEFINER・クライアントからは実行不可・
--          発火はcronのみ・失敗は cron_watchdog が監視する
--   原則4＝導入は「初回実行が削除0件」になるタイミングを選ぶ（最古 2026-06-05 ので1年前は0件）
-- キルスイッチ： select cron.unschedule('purge-app-errors');
create or replace function public.purge_old_app_errors()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from public.app_errors
   where created_at < now() - interval '1 year';
end;
$$;

-- クライアントからは叩けない（作成時のPUBLIC自動付与を落とす。from public と from anon の両方が必要
-- ＝2026-08-06の教訓。Supabaseは既定でanon/authenticatedにもEXECUTEを明示付与する）
revoke all on function public.purge_old_app_errors() from public;
revoke all on function public.purge_old_app_errors() from anon;
revoke all on function public.purge_old_app_errors() from authenticated;

-- 毎日 03:50 UTC（閲覧履歴の掃除 purge-page-events = 03:40 と重ならない時刻）
do $$
begin
  perform cron.unschedule('purge-app-errors');
exception when others then null;
end $$;

select cron.schedule('purge-app-errors', '50 3 * * *', $cron$select public.purge_old_app_errors();$cron$);
