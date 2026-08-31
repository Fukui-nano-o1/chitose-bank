-- employer_trust_info の ended_jobs が「status='open' かつ 期間が過ぎた求人」だけを数え、
-- status='closed'（掲載終了・満員終了・最終日クローズ）を1件も数えていなかった＝
-- 実際に5件の求人を終えた農家でも「終了した求人 0件」と出る過少計上（2026-08-31・記録タブの
-- カード化で露見：統計0件の真下に終了した求人のカードが5枚並ぶ矛盾になる）。
-- 修正＝ended_jobs は closed も数える（closed または open で期間経過）。open_jobs は不変。
-- ★関数本文は書き写さず、現物（pg_get_functiondef）のアンカー1箇所だけを置換して作り直す（家の作法）。
--   置換が1箇所ちょうどであることを検査し、想定外なら例外で全巻き戻し。
do $$
declare
  v_def text;
  v_old text := $old$'ended_jobs', (select count(*) from public.jobs j
                    where j.farmer_id = p_farmer_id and j.status = 'open'
                      and coalesce(j.date_end, j.date_start) < v_today),$old$;
  v_new text := $new$'ended_jobs', (select count(*) from public.jobs j
                    where j.farmer_id = p_farmer_id
                      and (j.status = 'closed'
                           or (j.status = 'open'
                               and coalesce(j.date_end, j.date_start) < v_today))),$new$;
  v_cnt int;
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc where pronamespace = 'public'::regnamespace and proname = 'employer_trust_info';
  if v_def is null then raise exception 'employer_trust_info not found'; end if;
  v_cnt := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_cnt <> 1 then raise exception 'anchor count % (expected 1) - aborting', v_cnt; end if;
  execute replace(v_def, v_old, v_new);
end $$;
