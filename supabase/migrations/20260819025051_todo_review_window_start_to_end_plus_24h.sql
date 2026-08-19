-- 評価の箱（農家＝バイトの評価／働き手＝仕事の評価）の窓を「作業開始〜終了+24時間」に揃える
-- （2026-08-19たきと指示）。従来：農家＝作業開始〜完了+3日／働き手＝完了〜完了+3日（作業中は灯らなかった）。
-- 変更：①完了後の窓を3日→24時間（農家・働き手の2箇所）②働き手にも「作業中」の枝を足す。
--
-- ★実装の作法：関数の本文を書き写さず、現物(pg_get_functiondef)に置換をかけて作り直す。
--   理由は2つ＝(1)長い本文の写経ミスを構造的に防ぐ (2)本文に日本語リテラル '【面接の質問】' があり、
--   打ち直すと文字化けの危険がある（2026-08-16の教訓）。置換件数は毎回検査し、想定外なら中止する。
do $do$
declare
  v_def text;
  v_new text;
  v_worker_old constant text := 'when status = ''completed'' and attended is distinct from false';
  v_worker_new constant text :=
    'when status = ''working'' and attended is distinct from false'
    || ' and not exists(select 1 from reviews r where r.application_id = wa.id and r.reviewer_id = uid) then ''w_review'''
    || E'\n        ' || 'when status = ''completed'' and attended is distinct from false';
  v_n int;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'my_todo_items' and prokind = 'f';
  if v_def is null then raise exception 'my_todo_items not found'; end if;

  -- ① 完了後の窓：3日 → 24時間（農家・働き手の2箇所）
  v_n := (length(v_def) - length(replace(v_def, 'interval ''3 days''', ''))) / length('interval ''3 days''');
  if v_n <> 2 then raise exception 'unexpected count of 3 days: %', v_n; end if;
  v_new := replace(v_def, 'interval ''3 days''', 'interval ''24 hours''');

  -- ② 働き手：作業中（作業開始〜）にも灯す枝を、完了の枝の手前に足す
  v_n := (length(v_new) - length(replace(v_new, v_worker_old, ''))) / length(v_worker_old);
  if v_n <> 1 then raise exception 'unexpected count of worker branch: %', v_n; end if;
  v_new := replace(v_new, v_worker_old, v_worker_new);

  execute v_new;
end
$do$;
