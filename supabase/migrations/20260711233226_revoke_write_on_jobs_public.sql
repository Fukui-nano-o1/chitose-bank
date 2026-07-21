-- ビュー再作成時にSupabaseのデフォルト権限がanon/authenticatedにフル権限を付与していた。
-- jobs_public は単純ビュー＝自動更新可能、かつ security_invoker=false（postgres権限で実行）のため、
-- 書き込み権限が残っていると RLS を迂回して jobs を改ざんできる。読み取り専用に戻す。
revoke all on public.jobs_public from anon, authenticated;
grant select on public.jobs_public to anon, authenticated;

-- 再発防止：読み取り専用ビューであることをDDLレベルで固定する
alter view public.jobs_public set (security_barrier = true);