-- 修正依頼のチャット・メールに該当リンク先を添付（2026-07-19）
-- 働き手の自己紹介→ #/profile/worker/profile（赤帯の出る編集ページ）
-- 求人→ #/work/edit/{job_number}（該当求人の編集フロー）

CREATE OR REPLACE FUNCTION public.request_worker_pr_revision(p_auth_id uuid, p_reason text, p_targets jsonb default '[]'::jsonb)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_has boolean;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    return json_build_object('ok', false, 'reason', 'reason_required');
  end if;

  select (coalesce(btrim(pr_pending),'') <> ''
          or jsonb_array_length(coalesce(pr_qa_pending,'[]'::jsonb)) > 0)
    into v_has from public.worker_profiles where auth_id = p_auth_id;
  if v_has is distinct from true then
    return json_build_object('ok', false, 'reason', 'no_pending');
  end if;

  update public.worker_profiles
     set pr_submitted_at = null,
         pr_revision_targets = coalesce(p_targets, '[]'::jsonb)
   where auth_id = p_auth_id;

  insert into public.admin_messages (user_id, from_admin, body)
  values (p_auth_id, true,
    '自己紹介の修正をお願いします。' || E'\n\n' ||
    '■ 修正をお願いする点：' || E'\n' || p_reason || E'\n\n' ||
    'プロフィールの自己紹介を修正して保存すると、あらためて運営が確認します。' || E'\n\n' ||
    '▶ 修正はこちら：https://chitose-bank.com/#/profile/worker/profile');

  begin
    perform public.send_user_email(p_auth_id,
      '[chitose-bank] 自己紹介の修正のお願い',
      'ご記入いただいた自己紹介について、以下の点の修正をお願いします。' || E'\n\n' ||
      '■ 修正をお願いする点：' || E'\n' || p_reason || E'\n\n' ||
      'プロフィールの自己紹介を修正して保存すると、あらためて運営が確認します。' || E'\n' ||
      '詳しくはサイト内チャットの「運営」もご覧ください。' || E'\n\n' ||
      '▶ 修正はこちら：https://chitose-bank.com/#/profile/worker/profile');
  exception when others then null; end;

  return json_build_object('ok', true);
end; $function$;

CREATE OR REPLACE FUNCTION public.request_job_revision(p_job_number integer, p_reason text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_farmer uuid; v_status text; v_ref text;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    return json_build_object('ok', false, 'reason', 'reason_required');
  end if;
  select farmer_id, status into v_farmer, v_status from public.jobs where job_number = p_job_number;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_status not in ('pending','open') then
    return json_build_object('ok', false, 'reason', 'not_revisable', 'status', v_status);
  end if;
  v_ref := public.job_ref(p_job_number,'farmer');
  update public.jobs set status = 'draft' where job_number = p_job_number;
  insert into public.notifications (farmer_id, type, message)
  values (v_farmer, 'job_revision_requested',
          'あなたの求人 #' || p_job_number || ' の修正をお願いします：' || p_reason);
  begin
    perform public.send_user_email(v_farmer,
      '[chitose-bank] あなたの求人 #' || p_job_number || ' の修正のお願い',
      '■ ' || v_ref || E'\n\n' ||
      '確認の結果、以下の点の修正をお願いすることになりました。' || E'\n\n' ||
      '■ 修正をお願いする点：' || E'\n' || p_reason || E'\n\n' ||
      '求人は「作成中」に戻しています。修正のうえ、もう一度掲載してください。' || E'\n' ||
      '（内容の正確な表示のためのお願いであり、採否には一切関与しません）' || E'\n\n' ||
      '▶ この求人の修正はこちら：https://chitose-bank.com/#/work/edit/' || p_job_number);
  exception when others then null; end;
  return json_build_object('ok', true);
end; $function$;

CREATE OR REPLACE FUNCTION public.request_profile_revision(p_auth_id uuid, p_reason text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_pr text; v_nickname text;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    return json_build_object('ok', false, 'reason', 'reason_required');
  end if;

  select pr, nickname into v_pr, v_nickname
    from public.worker_profiles where auth_id = p_auth_id;

  update public.worker_profiles
     set pr_hidden_original = coalesce(pr_hidden_original, v_pr),
         pr = null
   where auth_id = p_auth_id;

  insert into public.notifications (farmer_id, type, message)
  values (p_auth_id, 'profile_revision_requested',
          '自己紹介の修正をお願いします：' || p_reason);
  begin
    perform public.send_user_email(p_auth_id,
      '[chitose-bank] 自己紹介の修正のお願い',
      'ご記入いただいた自己紹介について、以下の点の修正をお願いします。' || E'\n\n' ||
      '■ 修正をお願いする点：' || E'\n' || p_reason || E'\n\n' ||
      '現在、自己紹介は一時的に非表示になっています。' || E'\n' ||
      '修正して保存すると、ふたたび表示されます。' || E'\n\n' ||
      '▶ 修正はこちら：https://chitose-bank.com/#/profile/worker/profile');
  exception when others then null; end;

  return json_build_object('ok', true);
end; $function$;