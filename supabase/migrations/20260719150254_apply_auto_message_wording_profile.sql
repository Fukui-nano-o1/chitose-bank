-- 応募の自動メッセージ文言変更（2026-07-19）：「確認をお願いします」→「プロフィールの確認をお願いします」
-- （「応募された求人を見る→」リンクと求人ボックスはフロント側で自動メッセージの直後に描画）
CREATE OR REPLACE FUNCTION public.apply_to_job(p_job_number integer)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_worker_id uuid;
  v_farmer_id uuid;
  v_status text;
  v_app_id uuid;
  v_nickname text;
  v_qa_count int := 0;
  v_under_review boolean;
  v_revision boolean;
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

  -- 自己紹介が審査中（審査待ち／修正依頼中）は応募不可（2026-07-19）
  select (coalesce(btrim(wp.pr_pending),'') <> ''
          or jsonb_array_length(coalesce(wp.pr_qa_pending,'[]'::jsonb)) > 0),
         wp.pr_submitted_at is null
    into v_under_review, v_revision
    from public.worker_profiles wp where wp.auth_id = v_worker_id;
  if coalesce(v_under_review, false) then
    return json_build_object('ok', false, 'reason', 'profile_under_review',
                             'revision', coalesce(v_revision, false));
  end if;

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