-- 働き手の自己紹介（審査待ちpr_pending/pr_qa_pending）への修正依頼（2026-07-19）
-- 運営チャット（admin_messages）＋メール（send_user_email）をセットで送る。
-- 下書きは本人の修正材料として残し、pr_submitted_atだけ外す（審査キューはpr_submitted_at基準で除外）。
-- 本人がプロフィールを修正して保存すると pr_submitted_at が再セットされ、審査キューに再登場する。
CREATE OR REPLACE FUNCTION public.request_worker_pr_revision(p_auth_id uuid, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  update public.worker_profiles set pr_submitted_at = null where auth_id = p_auth_id;

  insert into public.admin_messages (user_id, from_admin, body)
  values (p_auth_id, true,
    '自己紹介の修正をお願いします。' || E'\n\n' ||
    '■ 修正をお願いする点：' || E'\n' || p_reason || E'\n\n' ||
    'プロフィールの自己紹介を修正して保存すると、あらためて運営が確認します。');

  begin
    perform public.send_user_email(p_auth_id,
      '[chitose-bank] 自己紹介の修正のお願い',
      'ご記入いただいた自己紹介について、以下の点の修正をお願いします。' || E'\n\n' ||
      '■ 修正をお願いする点：' || E'\n' || p_reason || E'\n\n' ||
      'プロフィールの自己紹介を修正して保存すると、あらためて運営が確認します。' || E'\n' ||
      '詳しくはサイト内チャットの「運営」もご覧ください。' || E'\n\n' ||
      'https://chitose-bank.com/#/profile');
  exception when others then null; end;

  return json_build_object('ok', true);
end; $function$;