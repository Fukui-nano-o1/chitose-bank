-- プラポリ第3条データ台帳の約束「ページの閲覧履歴＝取得から30日で削除します」を果たす削除機構。
-- 2026-08-07 プラポリ照合の実機一周で、約束はあるのに削除する仕組み（cron/関数）が無いと判明。
-- summarize_sessions は summarized=true にするだけで消さない＝page_events は無期限に溜まっていた。
-- 最古行は 2026-07-14。導入時点で30日超は0件so無害に入れられ、以後は約束どおり自動で効く。
-- 旧ポリシー時代（self-admin-only 導入 20260727133449 以前）に入った非管理者の行も、30日を過ぎ次第この掃除で消える。
-- チャット3年・契約3年・通報3年の削除は保存期間that長く別途（2026-07-19の方針どおり未実装のまま）。本掃除は30日枠のpage_eventsのみ。

create or replace function public.purge_old_page_events()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from public.page_events
   where ts < now() - interval '30 days';
end;
$$;

revoke all on function public.purge_old_page_events() from public, anon, authenticated;

select cron.schedule('purge-page-events', '40 3 * * *', 'select public.purge_old_page_events();');
