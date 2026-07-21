-- 審査差し戻し：pending の求人を draft に戻し、修正してほしい点を農家に通知する。
-- 職安法上の位置づけ：的確表示義務（5条の4）に基づく場の管理。採用への関与ではない。
create or replace function public.request_job_revision(p_job_number int, p_reason text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farmer uuid;
  v_status text;
  v_crop text;
  v_task text;
begin
  -- 管理者のみ
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    return json_build_object('ok', false, 'reason', 'reason_required');
  end if;

  select farmer_id, status, crop, task into v_farmer, v_status, v_crop, v_task
    from public.jobs where job_number = p_job_number;

  if v_farmer is null then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_status <> 'pending' then
    return json_build_object('ok', false, 'reason', 'not_pending', 'status', v_status);
  end if;

  update public.jobs set status = 'draft' where job_number = p_job_number;

  -- 農家へのアプリ内通知（理由付き）
  insert into public.notifications (farmer_id, type, message)
  values (v_farmer, 'job_revision_requested',
          '求人 #' || p_job_number || ' の修正をお願いします：' || p_reason);

  -- 農家への理由付きメール
  begin
    perform public.send_user_email(
      v_farmer,
      '[chitose-bank] 求人 #' || p_job_number || ' の修正のお願い',
      'ご掲載いただいた求人 #' || p_job_number ||
        '（' || coalesce(v_crop,'') || ' ' || coalesce(v_task,'') || '）について、' || E'\n' ||
      '公開前の確認で、以下の点の修正をお願いすることになりました。' || E'\n\n' ||
      '■ 修正をお願いする点：' || E'\n' || p_reason || E'\n\n' ||
      '求人は「作成中」に戻しています。修正のうえ、もう一度掲載してください。' || E'\n' ||
      '（内容の正確な表示のためのお願いであり、採否には一切関与しません）' || E'\n\n' ||
      'https://chitose-bank.com/#/profile/employer'
    );
  exception when others then null;
  end;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.request_job_revision(int, text) to authenticated;