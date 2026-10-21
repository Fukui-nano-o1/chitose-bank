-- 2026-08-28 たきと指示「ブロッコリー播種にキリトが応募したのにカレンダーに反映されてない」
-- get_my_calendar_jobs の応募の状態に 'applied'（応募中）を追加＝応募が届いた時点で盤面に出る。
-- 見送り・失効・取り消しは従来どおり出さない（働かなかった日を予定として塗らない）。
-- ※関数本体の日本語は書き写さず、現物のアンカーを1箇所だけ置換して作り直す（家の作法）
do $mig$
declare
  v_def text;
  b_old text := 'array[''approved'',''meeting'',''interview'',''contracted'',''working'',''completed'']';
  b_new text := 'array[''applied'',''approved'',''meeting'',''interview'',''contracted'',''working'',''completed'']';
begin
  v_def := pg_get_functiondef('public.get_my_calendar_jobs()'::regprocedure);
  if (length(v_def) - length(replace(v_def, b_old, ''))) / length(b_old) <> 1 then
    raise exception 'anchor not found exactly once';
  end if;
  execute replace(v_def, b_old, b_new);
end
$mig$;
