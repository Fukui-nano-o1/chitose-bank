-- 面接の質問集の廃止（2026-08-17 たきと指示「面接の質問集は削除。関連要素も削除。」）
-- 面接のやり取りはチャットで直接行う。承認の次にやることは採用（hire）に一本化する。
--
-- ★消すもの（機能）：送信RPC send_interview_questions／やること2つ（農家 interview＝面接の質問を送る、
--   働き手 w_interview＝面接の回答）／応募者データの qsent_ids（質問を送ったかの印）。
-- ★残すもの（記録）：farmer_question_sets（18行）・interview_question_sends（12行）の各テーブルと、
--   チャットに投函済みの【面接の質問】メッセージ（12件）。
--   理由＝行動記録の憲法（利用者のアクションは記録として残す・当事者が消せない）とチャット履歴の保全
--   （2026-07-19・期限前の削除はいかなる理由でも行わない）。機能が無くなれば新しい行は増えない。
--   テーブルそのものの削除は、保存・削除の設計台帳v1 原則4（設計→たきと確認→実装）に従って別途判断する。
--
-- ★長い関数は写経せず、いまの本番定義（pg_get_functiondef）を土台に置換して作り直す
--   （2026-08-17 process_withdrawal と同じ手法。写経ミスと、過去のmigrationからコピーして
--    後から入った修正を消す事故の両方を避ける）。

do $$
declare v_def text; v_new text; v_a int; v_b int;
begin
  -- ① my_todo_items から finterview / winterview の2つのCTEと、その union all を外す
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'my_todo_items';
  if v_def is null then raise exception 'my_todo_items が見つかりません'; end if;
  v_new := v_def;

  -- finterview（農家：質問をまだ送っていない応募）
  v_new := regexp_replace(v_new, '  finterview as \(.*?\n  \),\n(?=  fhire as \()', '', 'ns');
  -- winterview（働き手：【面接の質問】に未返信の応募）＝最後のCTEなので直前のカンマごと落とす
  v_new := regexp_replace(v_new, ',\n  winterview as \(.*?\n  \)\n(?=  select )', E'\n', 'ns');
  -- union all の2本
  v_new := replace(v_new,
    E'  union all\n  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from finterview\n', '');
  v_new := replace(v_new,
    E'\n  union all\n  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from winterview', '');

  if v_new like '%interview_question_sends%' or v_new like '%finterview%' or v_new like '%winterview%'
     or v_new like '%【面接の質問】%' then
    raise exception 'my_todo_items から面接の質問集の参照を外しきれませんでした';
  end if;
  if v_new = v_def then raise exception 'my_todo_items が置換されませんでした'; end if;
  execute v_new;

  -- ② my_farm_applicants から qsent_ids のキーを外す（'qsent_ids' 行の頭から次の 'profiles' の直前まで）
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'my_farm_applicants';
  if v_def is null then raise exception 'my_farm_applicants が見つかりません'; end if;
  v_a := position('''qsent_ids''' in v_def);
  v_b := position('''profiles''' in v_def);
  if v_a = 0 or v_b = 0 or v_b <= v_a then raise exception 'my_farm_applicants の qsent_ids の位置を特定できませんでした'; end if;
  v_new := substring(v_def for v_a - 1) || substring(v_def from v_b);
  if v_new like '%interview_question_sends%' or v_new like '%qsent_ids%' then
    raise exception 'my_farm_applicants から qsent_ids を外しきれませんでした';
  end if;
  execute v_new;
end $$;

-- ③ 送信RPCを削除（フロントからの呼び出しはすべて撤去済み）
drop function if exists public.send_interview_questions(uuid, uuid);

-- 関数を作り直したので権限を宣言し直す（作成時の default privileges で anon にも付くため・2026-08-06教訓）
revoke all on function public.my_todo_items() from public, anon;
revoke all on function public.my_farm_applicants() from public, anon;
grant execute on function public.my_todo_items() to authenticated, service_role;
grant execute on function public.my_farm_applicants() to authenticated, service_role;
