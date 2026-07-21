-- リピート即決の文言修正（2026-07-19たきと指示）：承認は採用ではないと必ず念を押す。
-- 「確定」等の採用と誤認させる表現を排し、（）内は採用ではない旨に統一
CREATE OR REPLACE FUNCTION public.trg_instant_approve()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_instant boolean; v_want boolean;
begin
  if new.status <> 'applied' then return new; end if;
  select instant_approve_repeat into v_instant from public.jobs where job_number = new.job_number;
  if not coalesce(v_instant, false) then return new; end if;
  select exists (
    select 1 from public.reviews r
     where r.reviewer_id = new.farmer_id and r.reviewee_id = new.worker_id
       and r.direction = 'farmer_to_worker' and r.want_again = true
  ) into v_want;
  if not v_want then return new; end if;

  update public.applications set status = 'approved', decided_at = now() where id = new.id;

  insert into public.notifications (farmer_id, type, message) values
    (new.worker_id, 'application_approved',
     '🌟即決で承認されました：求人 #' || new.job_number || '　（承認は採用ではありません。打ち合わせのあとに決まります）'),
    (new.farmer_id, 'application_approved',
     '🌟リピート即決：以前「また呼びたい」と評価した方の応募を自動承認しました（求人 #' || new.job_number || '・採用の決定はチャットで）');
  begin
    perform public.send_user_email(new.worker_id,
      '[chitose-bank] 🌟即決で承認されました：求人 #' || new.job_number,
      '■ ' || public.job_ref(new.job_number,'worker') || E'\n\n' ||
      '応募が、即決で承認されました。' || E'\n' ||
      'この求人者から以前「また呼びたい」の評価を受けているため、選考なしで承認されています。' || E'\n' ||
      '（承認は採用ではありません。採用は打ち合わせ・面接のあとに決まります）' || E'\n\n' ||
      'チャットで日程を確認しましょう：https://chitose-bank.com/#/chats' ||
      public.job_link(new.job_number));
    perform public.send_user_email(new.farmer_id,
      '[chitose-bank] 🌟リピート即決のお知らせ：求人 #' || new.job_number,
      '■ ' || public.job_ref(new.job_number,'farmer') || E'\n\n' ||
      'あなたが以前「また呼びたい」と評価した方から応募があり、' || E'\n' ||
      '求人の設定に基づいて自動承認しました。' || E'\n' ||
      '（承認は採用ではありません。チャットで打ち合わせのうえ「採用する」で決定してください）' || E'\n\n' ||
      '応募者の確認：https://chitose-bank.com/#/profile/employer/applicants' ||
      public.job_link(new.job_number));
  exception when others then null; end;
  return new;
end; $function$;

-- チャットの自動返信（apply_to_job内・リピート即決時）も採用ではない旨を明記
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
    values (v_app_id, v_worker_id, 'あなたの求人に応募しました！確認をお願いします。');
    if exists (select 1 from public.applications a where a.id = v_app_id and a.status = 'approved') then
      insert into public.messages (application_id, sender_id, body)
      values (v_app_id, v_farmer_id, '🌟リピート即決の設定により、応募を自動で承認しました（採用ではありません）。チャットで打ち合わせを進めましょう。');
    end if;
  exception when others then null; end;

  return json_build_object('ok', true, 'application_id', v_app_id);
end;
$function$;