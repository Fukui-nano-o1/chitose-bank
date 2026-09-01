-- 保険の準備の報告を、採用したどの仕事でも出す（2026-09-01たきと報告「ページが空」の原因）。
--
-- 何が起きていたか：my_todo_items の insurance の枝に「プロフィールに保険を申告していない農家だけ」
-- という条件（2026-07-25 insurance_todo_only_unset）が残っていた。当時は報告＝「保険を用意したか」の
-- 有無だけだったので、申告済みの農家には出す用事が無い、という考え方だった。
-- ところが同日の作り直しで、報告は【この仕事のためにどの保険を準備したかをカードで選んで相手に伝える】
-- ものになった（1日単位の傷害保険のように、仕事ごとに掛けるものもある）。この条件が残っていると、
-- 保険を申告している農家には用件が一度も出ず、カードも報告も永久に使えない
-- （実データで3件＝#1028・#1047・#1048 が隠れていた）。ので条件を外す＝採用した仕事
-- （承認〜作業中）で、まだ報告していないものは必ず並ぶ。
--
-- 変えていないもの：枝の順番（作業が終わっていれば「バイトの評価」が先）・報告済みは出ない・
--   他の用件・返り値の形。関数の本文は写経せず、現物のアンカーを1箇所だけ置き換える（家の作法）。
do $do$
declare d text; n int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public' and p.proname = 'my_todo_items';
  n := (length(d) - length(replace(d, 'from employer_profiles ep,', ''))) / length('from employer_profiles ep,');
  if n <> 1 then raise exception 'anchor count mismatch: %', n; end if;
  d := regexp_replace(d,
    'and not exists \(select 1 from employer_profiles ep,.*?it <> ''considering''\) then ''insurance''',
    'then ''insurance''', 'gs');
  n := (length(d) - length(replace(d, 'from employer_profiles ep,', ''))) / length('from employer_profiles ep,');
  if n <> 0 then raise exception 'replace failed: %', n; end if;
  execute d;
end $do$;
