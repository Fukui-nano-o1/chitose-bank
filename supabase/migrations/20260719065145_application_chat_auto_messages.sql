-- 応募のチャット化（2026-07-19たきと指示）：
-- ①応募と同時に、働き手の発言として「あなたの求人に応募しました！確認をお願いします。」を自動送信
-- ②農家の承認/見送りに応じて、農家の発言として自動返信（承認→打合せ・面接へ／見送り→お礼）
-- ③リピート即決の自動承認時は、農家の自動返信も添える（設定に基づく旨を明記）
CREATE OR REPLACE FUNCTION public.apply_to_job(p_job_number integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- 応募の自動メッセージ（働き手の発言としてチャットへ・2026-07-19）
  begin
    insert into public.messages (application_id, sender_id, body)
    values (v_app_id, v_worker_id, 'あなたの求人に応募しました！確認をお願いします。');
    -- リピート即決（trg_instant_approve）で既に承認済みなら、農家の自動返信も添える
    if exists (select 1 from public.applications a where a.id = v_app_id and a.status = 'approved') then
      insert into public.messages (application_id, sender_id, body)
      values (v_app_id, v_farmer_id, '🌟リピート即決の設定により、応募を自動で承認しました。チャットで打ち合わせを進めましょう。');
    end if;
  exception when others then null; end;

  return json_build_object('ok', true, 'application_id', v_app_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_application(p_application_id uuid, p_approve boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid; v_farmer uuid; v_worker uuid; v_status text; v_job int; v_new text; v_ref text;
  v_link text := 'https://chitose-bank.com/#/profile/worker/approved';
begin
  v_caller := auth.uid();
  if v_caller is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  select farmer_id, worker_id, status, job_number
    into v_farmer, v_worker, v_status, v_job
    from public.applications where id = p_application_id;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_farmer <> v_caller then return json_build_object('ok', false, 'reason', 'not_your_application'); end if;
  if v_status <> 'applied' then return json_build_object('ok', false, 'reason', 'already_decided', 'status', v_status); end if;

  v_new := case when p_approve then 'approved' else 'rejected' end;
  update public.applications set status = v_new, decided_at = now() where id = p_application_id;
  v_ref := public.job_ref(v_job,'worker');

  -- ボタンに応じた自動返信（農家の発言としてチャットへ・2026-07-19）
  begin
    if p_approve then
      insert into public.messages (application_id, sender_id, body)
      values (p_application_id, v_farmer, '応募を承認しました。ここからは、チャットで打ち合わせや面接を進めましょう。');
    else
      insert into public.messages (application_id, sender_id, body)
      values (p_application_id, v_farmer, '今回は見送りとさせていただきます。ご応募ありがとうございました。');
    end if;
  exception when others then null; end;

  if p_approve then
    insert into public.notifications (farmer_id, type, message)
    values (v_worker, 'application_approved',
            '応募が承認されました：求人 #' || v_job || '　チャットで日程を打ち合わせましょう');
    begin
      perform public.send_user_email(v_worker,
        '[chitose-bank] 応募が承認されました：求人 #' || v_job,
        '■ ' || v_ref || E'\\n\\n' ||
        '応募が承認されました。' || E'\\n' ||
        'サイト内のチャットで、日程や集合場所を打ち合わせましょう。' || E'\\n\\n' ||
        '承認された応募とチャット：' || v_link || public.job_link(v_job));
    exception when others then null; end;
  else
    insert into public.notifications (farmer_id, type, message)
    values (v_worker, 'application_declined',
            '求人 #' || v_job || '：今回はご縁がありませんでした。他の求人もぜひご覧ください');
    begin
      perform public.send_user_email(v_worker,
        '[chitose-bank] 応募の結果について：求人 #' || v_job,
        '■ ' || v_ref || E'\\n\\n' ||
        '今回はご縁がありませんでした。ご応募ありがとうございました。' || E'\\n\\n' ||
        '募集の人数や日程の都合による見送りも多くあります。' || E'\\n' ||
        'プロフィールを充実させると、承認されやすくなります。' || E'\\n\\n' ||
        '他の求人を見る：https://chitose-bank.com/#/search');
    exception when others then null; end;
  end if;
  return json_build_object('ok', true, 'status', v_new);
end; $function$;

-- 未読集計：承認待ち(applied)・見送り(rejected)のスレッドもチャット一覧に出るため対象に追加
CREATE OR REPLACE FUNCTION public.my_unread_message_counts()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'chat', (SELECT count(*) FROM messages m JOIN applications a ON a.id = m.application_id
             WHERE (a.worker_id = auth.uid() OR a.farmer_id = auth.uid())
               AND a.status IN ('applied','approved','meeting','interview','contracted','working','completed','rejected')
               AND m.sender_id <> auth.uid() AND m.read_at IS NULL),
    'dm', (SELECT count(*) FROM admin_messages am
           WHERE am.user_id = auth.uid() AND am.from_admin AND am.read_at IS NULL),
    'by_application', (SELECT coalesce(json_object_agg(t.application_id, t.cnt), '{}'::json) FROM (
        SELECT m.application_id, count(*) AS cnt
        FROM messages m JOIN applications a ON a.id = m.application_id
        WHERE (a.worker_id = auth.uid() OR a.farmer_id = auth.uid())
          AND a.status IN ('applied','approved','meeting','interview','contracted','working','completed','rejected')
          AND m.sender_id <> auth.uid() AND m.read_at IS NULL
        GROUP BY m.application_id) t)
  );
$$;