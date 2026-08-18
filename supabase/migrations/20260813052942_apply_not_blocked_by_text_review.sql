-- ============================================================================
-- ★★ このファイルの apply_to_job は【古い定義】です。土台にしないでください ★★
--   ここに書かれた apply_to_job は「ニックネーム＋Q&A回答1件以上」を要求する旧ゲートを
--   含んでいます。2026-08-17の段C（20260817100956_apply_gate_single_condition）で、
--   応募の条件は is_worker_profile_ready（4項目）に一本化されました。
--   create or replace なので、このファイルを再実行したり、ここの本文をコピーして
--   新しい migration を書くと、段Cが【無言で】巻き戻ります（エラーは出ません）。
--   症状＝正面の応募は弾かれるのに、仮応募からの昇格だけ通る（条件が割れる）。
--
--   現行の正：apply_to_job = 20260817100956 ／ is_worker_profile_ready = 20260817100444
--   新しく apply_to_job を触るときは、必ず本番の現定義を土台にすること
--   （select pg_get_functiondef(oid) from pg_proc where proname='apply_to_job'）。
--   巻き戻りは supabase/checks/audit.sql の検査⑦が検出します。
-- ============================================================================
-- 自由記述の審査が応募を止めないようにする（2026-08-13たきと報告
-- 「働き手が応募するたびに自由記述の欄が申請される。何度も許可した。それで応募できない。これ何回するの？」）。
--
-- 【行き止まりの構造】
--   ① 応募ゲート（apply_profile_gate）は【承認済み】の pr_qa の答えが1件以上あることを求める
--   ② 質問に答えると、答えは pr_qa ではなく pr_qa_pending（審査待ち）に入る＝承認されるまで①は0件のまま
--   ③ さらに pr_pending/pr_qa_pending があると profile_under_review で応募自体が弾かれる
--   ④ 待っている間にプロフィールを保存し直すと、審査待ちがまた作り直される（申請時刻もリセット）
--   ⇒「応募したい→自己紹介を書け→書いたら審査待ちで応募できない→保存のたびに審査がやり直し」の輪。
--     承認が1回できれいに通るまで、何度でも繰り返す状態になっていた。
--
-- 【直す方針＝設計に書いてある原則に戻す】
--   lib/workerReady.js に明記の原則：「運営の自由記述（自己紹介）審査は条件に含まれない
--   ＝審査は応募をブロックしない」。apply_to_job がこの原則に反していたので合わせる。
--   安全性：未承認の自由記述は農家に見えない（worker_profile_for_farmer が under_review を返して
--   本文を伏せる・2026-08-07）。ので応募を通しても、審査前の文字が農家に届くことはない。
--   審査の意味（連絡先の記載・個人の特定・不適切な表現を【公開前に】止める）は一切弱まらない。
--
-- 【変更2点】
--   (a) profile_under_review による応募の拒否をやめる
--   (b) 応募ゲートの答えの数え方を「承認済み＋審査待ち」に。本人が答えた事実を数える
--       （答えた瞬間に応募できる。農家に見えるのは承認後）
--   ※ create_pending_application（仮応募）は元から審査ゲートを持たないので変更なし

create or replace function public.apply_to_job(p_job_number integer, p_available_dates jsonb default null::jsonb)
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

revoke all on function public.apply_to_job(integer, jsonb) from public;
revoke all on function public.apply_to_job(integer, jsonb) from anon;
grant execute on function public.apply_to_job(integer, jsonb) to authenticated;
