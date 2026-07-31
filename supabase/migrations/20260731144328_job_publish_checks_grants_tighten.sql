-- 追記のみを権限でも担保する（2026-07-30）。新規テーブルの既定付与で authenticated に
-- UPDATE/DELETE/TRUNCATE まで付いていたため、SELECT と INSERT だけに絞る。
-- 変更・削除はトリガー（trg_jpc_lock_upd/del）でも拒否＝二重の壁。
revoke all on public.job_publish_checks from authenticated, anon;
grant select, insert on public.job_publish_checks to authenticated;
