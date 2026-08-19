-- カレンダーに下書きの日程を出さない（2026-08-19たきと指示「下書きの日程をカレンダーに反映しないように」）。
-- get_my_calendar_jobs の own_rows（自分の求人）は status を問わず全部返していたため、
-- まだ掲載していない下書きの作業日程まで盤面に塗られていた（実測：この時点で8件）。
-- 除くのは「下書き」だけ＝status='draft' かつ 一度も掲載していない（opened_at is null）。
-- 一時非公開（draft だが opened_at あり＝掲載歴あり・応募がついていることもある）は従来どおり出す
-- （lib/utils の isJobDraft と同じ線引き＝「下書き」の定義を増やさない）。
-- ★本番の現定義を土台に1行だけ差し込む（長い日本語コメントを打ち直して壊さないため・2026-08-16の教訓）。
--   置換できなければ例外で止める＝黙って別物を作らない。
do $$
declare d text; n text;
begin
  select pg_get_functiondef(oid) into d from pg_proc
   where proname = 'get_my_calendar_jobs' and pronamespace = 'public'::regnamespace;
  if d is null then raise exception 'get_my_calendar_jobs が見つからない'; end if;
  n := replace(d,
        'where j.farmer_id = auth.uid()' || E'\n' || '      and j.date_start is not null',
        'where j.farmer_id = auth.uid()' || E'\n' ||
        '      and not (j.status = ''draft'' and j.opened_at is null)' || E'\n' ||
        '      and j.date_start is not null');
  if n = d then raise exception '置換できなかった（own_rows の条件が想定と違う）'; end if;
  execute n;
end $$;
