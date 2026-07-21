-- 応募の承認/見送り。apply_to_job と同じ設計（RPCに集約・reason返却）。
-- security definer の理由：働き手宛の通知INSERTは、農家セッションのRLSでは書けないため。
create or replace function public.approve_application(p_application_id uuid, p_approve boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
  v_farmer uuid;
  v_worker uuid;
  v_status text;
  v_job int;
  v_new text;
begin
  v_caller := auth.uid();
  if v_caller is null then
    return json_build_object('ok', false, 'reason', 'not_logged_in');
  end if;

  select farmer_id, worker_id, status, job_number
    into v_farmer, v_worker, v_status, v_job
    from public.applications where id = p_application_id;

  if v_farmer is null then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- 承認できるのは、その求人の農家本人だけ
  if v_farmer <> v_caller then
    return json_build_object('ok', false, 'reason', 'not_your_application');
  end if;

  -- 遷移は applied からのみ（二重承認・見送り後の裏返しを防ぐ）
  if v_status <> 'applied' then
    return json_build_object('ok', false, 'reason', 'already_decided', 'status', v_status);
  end if;

  v_new := case when p_approve then 'approved' else 'rejected' end;
  update public.applications set status = v_new where id = p_application_id;

  -- 働き手への通知（「承認するとお知らせします」の約束を守る）。見送りは通知しない（当面）
  if p_approve then
    insert into public.notifications (farmer_id, type, message)
    values (v_worker, 'application_approved',
            '応募が承認されました：求人 #' || v_job || '　チャットで日程を打ち合わせましょう');
  end if;

  return json_build_object('ok', true, 'status', v_new);
end;
$$;

grant execute on function public.approve_application(uuid, boolean) to authenticated;