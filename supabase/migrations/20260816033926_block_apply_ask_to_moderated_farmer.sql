-- =============================================================================
-- 悪意あるユーザーのブロック（続き・2026-08-16）：BAN農家の求人への働きかけを塞ぐ
--
-- 背景：admin_moderate_account で農家をBANすると、その求人は jobs_public から
-- 消える（is_account_moderated除外・20260816012226）が、jobs テーブルでは
-- status='open' のまま残る。apply_to_job / ask_job_question は求人者(farmer)の
-- BANを見ず status='open' だけ見るため、求人No.（1000からの連番）直打ちで
-- ・応募が成立（ゴースト応募＝働き手が消えた求人に応募して待たされる）
-- ・質問が投函され、BAN農家に通知＋メールが飛ぶ
-- が通ってしまった（実弾で ok:true を確認）。
--
-- 対処：両RPCに求人者のBANチェックを追加。求人のstatusは触らない＝BAN解除で
-- 自然に応募・質問が再開する可逆な形（closedにすると解除で戻らない）。
-- 読み取り面（jobs_public/job_employer_profile/employer_trust_info）は前回除外済み
-- ＝これで読み書き両方が BAN農家の求人を一貫して遮断する。
-- =============================================================================

create or replace function public.apply_to_job(p_job_number integer, p_available_dates jsonb DEFAULT NULL::jsonb)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_worker_id uuid; v_farmer_id uuid; v_status text; v_app_id uuid;
  v_nickname text; v_qa_count int := 0;
  v_date_start date; v_date_end date; v_is_period boolean; v_avail jsonb;
begin
  v_worker_id := auth.uid();
  if v_worker_id is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  if public.is_account_moderated(v_worker_id) then
    return json_build_object('ok', false, 'reason', 'account_suspended');
  end if;

  select farmer_id, status, date_start, date_end into v_farmer_id, v_status, v_date_start, v_date_end from public.jobs where job_number = p_job_number;
  if v_farmer_id is null then return json_build_object('ok', false, 'reason', 'job_not_found'); end if;
  if v_status <> 'open' then return json_build_object('ok', false, 'reason', 'job_not_open'); end if;
  -- 求人者(農家)が停止・追放中なら、その求人は募集終了として扱う（2026-08-16）
  if public.is_account_moderated(v_farmer_id) then return json_build_object('ok', false, 'reason', 'job_not_open'); end if;
  if v_farmer_id = v_worker_id then return json_build_object('ok', false, 'reason', 'own_job'); end if;

  -- 期間求人（date_end有り・単日でない）は「来られる日」の宣言が必須。単日求人は null で従来どおり
  v_is_period := v_date_end is not null and v_date_end <> v_date_start;
  if v_is_period then
    if p_available_dates is null
       or not (p_available_dates = '"any"'::jsonb
               or (jsonb_typeof(p_available_dates) = 'array' and jsonb_array_length(p_available_dates) > 0)) then
      return json_build_object('ok', false, 'reason', 'dates_required');
    end if;
    v_avail := p_available_dates;
  else
    v_avail := null;
  end if;

  -- ★(a) 自由記述の審査待ち（pr_pending / pr_qa_pending）では応募を止めない。
  --   未承認の本文は農家に見えない（worker_profile_for_farmer が under_review を返す）＝公開はしていない。
  --   審査を「応募の関所」にすると、承認があるまで応募できず、待っている間の保存で審査がやり直しになる。

  if exists (select 1 from public.app_settings where key = 'apply_profile_gate' and value = 'true') then
    -- ★(b) 答えの数は「承認済み(pr_qa)＋審査待ち(pr_qa_pending)」で数える＝本人が答えた事実を見る。
    --   同じ質問に両方あっても二重に数えない（質問文で重複を除く）
    select wp.nickname,
           coalesce((select count(distinct e->>'q')
                       from jsonb_array_elements(
                              coalesce(wp.pr_qa, '[]'::jsonb) || coalesce(wp.pr_qa_pending, '[]'::jsonb)) e
                      where btrim(coalesce(e->>'a','')) <> ''), 0)
      into v_nickname, v_qa_count
      from public.worker_profiles wp where wp.auth_id = v_worker_id;
    if coalesce(btrim(v_nickname),'') = '' or v_qa_count < 1 then
      return json_build_object('ok', false, 'reason', 'profile_incomplete',
        'has_nickname', coalesce(btrim(v_nickname),'') <> '', 'qa_answered', v_qa_count, 'qa_required', 1);
    end if;
  end if;

  insert into public.applications (job_number, worker_id, farmer_id, status, available_dates)
  values (p_job_number, v_worker_id, v_farmer_id, 'applied', v_avail)
  on conflict (job_number, worker_id) do nothing
  returning id into v_app_id;
  if v_app_id is null then return json_build_object('ok', true, 'already', true); end if;

  begin
    insert into public.messages (application_id, sender_id, body)
    values (v_app_id, v_worker_id, 'あなたの求人に応募しました！プロフィールの確認をお願いします。');
    if exists (select 1 from public.applications a where a.id = v_app_id and a.status = 'approved') then
      insert into public.messages (application_id, sender_id, body)
      values (v_app_id, v_farmer_id, '🌟リピート即決の設定により、応募を自動で承認しました（採用ではありません）。チャットで打ち合わせを進めましょう。');
    end if;
  exception when others then null; end;

  return json_build_object('ok', true, 'application_id', v_app_id);
end; $function$;

create or replace function public.ask_job_question(p_job integer, p_question text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_farmer uuid; v_err text; v_id uuid;
begin
  if auth.uid() is null then return json_build_object('ok',false,'reason','not_logged_in'); end if;
  select farmer_id into v_farmer from public.jobs
   where job_number = p_job and status = 'open';
  if v_farmer is null then return json_build_object('ok',false,'reason','not_open'); end if;
  -- 求人者(農家)が停止・追放中なら、その求人は募集終了として扱う（2026-08-16）
  if public.is_account_moderated(v_farmer) then return json_build_object('ok',false,'reason','not_open'); end if;
  if v_farmer = auth.uid() then return json_build_object('ok',false,'reason','own_job'); end if;
  v_err := public.jq_ng_check(p_question);
  if v_err is not null then return json_build_object('ok',false,'reason','ng','message',v_err); end if;
  insert into public.job_questions (job_number, asker_id, question)
  values (p_job, auth.uid(), btrim(p_question)) returning id into v_id;
  insert into public.notifications (farmer_id, type, message)
  values (v_farmer, 'job_question', 'あなたの求人 #' || p_job || ' に質問が届きました');
  begin
    perform public.send_user_email(v_farmer,
      '[chitose-bank] 質問が届きました：あなたの求人 #' || p_job,
      '■ ' || public.job_ref(p_job,'farmer') || E'\n\n' ||
      '■ 質問：' || E'\n' || btrim(p_question) || E'\n\n' ||
      '回答は求人ページの「質問」タブからできます。' || E'\n' ||
      '回答は他の閲覧者にも公開され、同じ質問を減らせます。' ||
      public.job_link(p_job));
  exception when others then null; end;
  return json_build_object('ok', true, 'id', v_id);
end; $function$;
