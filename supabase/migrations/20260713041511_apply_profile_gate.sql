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
-- 応募条件の門（DB強制）：ニックネーム＋Q&A回答5件以上。
-- 全員に同一適用のプラットフォームルール＝運営による選別ではない（職安法の線の内側）。
-- スイッチ式（third_party_publish_allowed と同じ作法）。初期OFF＝今日の1件を塞がない。
insert into public.app_settings (key, value)
values ('apply_profile_gate', 'false')
on conflict (key) do nothing;

create or replace function public.apply_to_job(p_job_number int)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker_id uuid;
  v_farmer_id uuid;
  v_status text;
  v_app_id uuid;
  v_nickname text;
  v_qa_count int := 0;
begin
  v_worker_id := auth.uid();
  if v_worker_id is null then
    return json_build_object('ok', false, 'reason', 'not_logged_in');
  end if;

  select farmer_id, status into v_farmer_id, v_status
  from public.jobs where job_number = p_job_number;

  if v_farmer_id is null then
    return json_build_object('ok', false, 'reason', 'job_not_found');
  end if;

  if v_status <> 'open' then
    return json_build_object('ok', false, 'reason', 'job_not_open');
  end if;

  if v_farmer_id = v_worker_id then
    return json_build_object('ok', false, 'reason', 'own_job');
  end if;

  -- 応募条件の門（apply_profile_gate = 'true' の時のみ発動）
  if exists (select 1 from public.app_settings
              where key = 'apply_profile_gate' and value = 'true') then
    select wp.nickname,
           coalesce((select count(*) from jsonb_array_elements(coalesce(wp.pr_qa,'[]'::jsonb)) e
                      where btrim(coalesce(e->>'a','')) <> ''), 0)
      into v_nickname, v_qa_count
      from public.worker_profiles wp where wp.auth_id = v_worker_id;

    if coalesce(btrim(v_nickname),'') = '' or v_qa_count < 5 then
      return json_build_object(
        'ok', false, 'reason', 'profile_incomplete',
        'has_nickname', coalesce(btrim(v_nickname),'') <> '',
        'qa_answered', v_qa_count, 'qa_required', 5);
    end if;
  end if;

  insert into public.applications (job_number, worker_id, farmer_id, status)
  values (p_job_number, v_worker_id, v_farmer_id, 'applied')
  on conflict (job_number, worker_id) do nothing
  returning id into v_app_id;

  if v_app_id is null then
    return json_build_object('ok', true, 'already', true);
  end if;

  return json_build_object('ok', true, 'application_id', v_app_id);
end;
$$;