-- 保険の準備の報告を「チャットへの投函」にする（2026-09-01たきと指示「報告はチャットで送信」）。
--
-- 変わったこと：
--  1. 報告した保険の種類を受け取れるようにした（p_items＝保険カードでタップしたもの）。
--     ★引数が増えるので CREATE OR REPLACE では置き換わらない＝旧1引数版を drop してから作る。
--     新しい引数は default null なので、古いJSを掴んだ端末からの名前付き1引数の呼び出しもそのまま通る
--     （submit_farmer_review を6→10引数にした時と同じ作法・2026-08-20）。
--  2. 報告の中身をチャットに投函する（sender=募集主）。文面はDBが組み立てる＝クライアントから
--     渡ってくるのは【固定の対応表にあるキーだけ】で、任意の文字列は本文に入らない。
--  3. これまでの「お知らせ1行＋M09メール」は廃止した。チャットへの投函で
--     trg_notify_message が お知らせ・プッシュ・メール（M20）を出す＝同じ用件で二重に鳴らさない。
--     ★mail_registry の M09 は（廃止）に、使い方ガイドの一覧からも外す（M31を廃止した時と同じ後始末）。
-- 変えていないもの：当事者ゲート（募集主本人だけ）・冪等（報告済みなら already で何もしない）・
--   insurance_prepared_at の記録・返り値の形。

drop function if exists public.confirm_insurance(uuid);

create or replace function public.confirm_insurance(
  p_application_id uuid,
  p_items text[] default null
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid; v_farmer uuid; v_worker uuid; v_job int; v_prepared timestamptz;
  v_labels text; v_body text;
begin
  v_caller := auth.uid();
  if v_caller is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  select farmer_id, worker_id, job_number, insurance_prepared_at
    into v_farmer, v_worker, v_job, v_prepared
    from public.applications where id = p_application_id;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_farmer <> v_caller then return json_build_object('ok', false, 'reason', 'not_yours'); end if;
  if v_prepared is not null then return json_build_object('ok', true, 'already', true); end if;

  update public.applications set insurance_prepared_at = now() where id = p_application_id;

  -- 報告された保険の名前。固定の対応表にあるキーだけを日本語に直す（順番も表のとおり）。
  -- 「これから準備する(considering)」は未加入なので対象外＝報告の名前には出さない。
  select string_agg(m.label, chr(10) order by m.ord) into v_labels
  from (values
    ('day_accident',    1, '・1日単位の傷害保険'),
    ('annual_accident', 2, '・年間の傷害保険'),
    ('rosai',           3, '・労災保険'),
    ('facility',        4, '・施設・賠償責任保険'),
    ('vehicle',         5, '・車両保険')
  ) as m(k, ord, label)
  where m.k = any(coalesce(p_items, '{}'::text[]));

  v_body := '作業中のケガに備える保険の準備ができました。'
    || coalesce(chr(10) || v_labels, '')
    || chr(10) || chr(10)
    || '内容（種類・補償の範囲）が気になるときは、このチャットで気軽に聞いてください。';

  -- チャットへ投函（この関数は SECURITY DEFINER＝messages のRLSは適用されない）。
  -- 相手へのお知らせ・プッシュ・メールは trg_notify_message が担う
  insert into public.messages (application_id, sender_id, body)
  values (p_application_id, v_farmer, v_body);

  return json_build_object('ok', true);
end; $function$;

revoke all on function public.confirm_insurance(uuid, text[]) from public, anon;
grant execute on function public.confirm_insurance(uuid, text[]) to authenticated, service_role;

-- M09（保険の準備の報告メール）は廃止＝チャットの投函（M20）に置き換え。台帳の行は消さず印だけ付ける
-- （コンテンツ行のDMLなので本番へは execute_sql で適用済み・ここは写しとして残す）
-- update mail_registry set label = '（廃止）保険準備完了（働き手）＝チャットの投函（M20）に置き換え' where code = 'M09';
