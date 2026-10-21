-- 2026-08-25 たきと指示「なぜか、終了した求人がカレンダーから消えている。」
-- get_my_calendar_jobs に終了ぶんを戻す：
--   own_rows  … status='open' のみ → ('open','closed')（審査中・下書きは従来どおり出さない）
--   app_rows  … 応募の状態に 'completed' を追加（完了した仕事も予定として残る）
--   liked_rows… 変更なし（いいねは公開中だけ）
-- ※関数本体の日本語コメントは書き写さず、現物のアンカーを1箇所だけ置換して作り直す（家の作法）
do $mig$
declare
  v_def text;
  v_new text;
  v_oldc text := convert_from(decode('LS0g5YWs6ZaL5Lit44Gg44GR77yI57WC5LqG44O75a+p5p+75Lit44O75LiL5pu444GN44Gv5Ye644GV44Gq44GE77yJ','base64'),'UTF8');
  v_newc text := convert_from(decode('LS0g5YWs6ZaL5Lit44Go57WC5LqG44GX44Gf5rGC5Lq677yI5a+p5p+75Lit44O75LiL5pu444GN44Gv5Ye644GV44Gq44GE77yJ','base64'),'UTF8');
  a_old text;
  a_new text;
  b_old text := 'array[''approved'',''meeting'',''interview'',''contracted'',''working'']';
  b_new text := 'array[''approved'',''meeting'',''interview'',''contracted'',''working'',''completed'']';
begin
  v_def := pg_get_functiondef('public.get_my_calendar_jobs()'::regprocedure);

  a_old := 'and j.status = ''open''          ' || v_oldc;
  a_new := 'and j.status in (''open'',''closed'')          ' || v_newc;

  if (length(v_def) - length(replace(v_def, a_old, ''))) / length(a_old) <> 1 then
    raise exception 'anchor A not found exactly once';
  end if;
  if (length(v_def) - length(replace(v_def, b_old, ''))) / length(b_old) <> 1 then
    raise exception 'anchor B not found exactly once';
  end if;

  v_new := replace(v_def, a_old, a_new);
  v_new := replace(v_new, b_old, b_new);

  execute v_new;
end
$mig$;
