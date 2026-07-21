-- 応募の取消：承認判断前（applied）のみ・本人のみ。行は削除（再応募を可能にする）。
-- 記録はfirehoseメールに自動保全される。承認後のキャンセルは緊急連絡（attendance_events）の領分。
create or replace function public.cancel_application(p_application_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_worker uuid; v_farmer uuid; v_status text; v_job int; v_name text;
begin
  select worker_id, farmer_id, status, job_number into v_worker, v_farmer, v_status, v_job
    from public.applications where id = p_application_id;
  if v_worker is null then return json_build_object('ok', false, 'reason','not_found'); end if;
  if v_worker <> auth.uid() then return json_build_object('ok', false, 'reason','not_yours'); end if;
  if v_status <> 'applied' then
    return json_build_object('ok', false, 'reason','already_decided', 'status', v_status);
  end if;

  delete from public.applications where id = p_application_id;

  v_name := public.resolve_actor_name(v_worker);
  insert into public.notifications (farmer_id, type, message)
  values (v_farmer, 'application_cancelled',
          '応募が取り消されました：求人 #' || v_job || '　' || v_name || 'さん');
  begin
    perform public.send_user_email(v_farmer,
      '[chitose-bank] 応募の取り消し：求人 #' || v_job,
      v_name || 'さんが求人 #' || v_job || ' への応募を取り消しました。' || E'\n' ||
      '（承認前の取り消しのため、対応は不要です）');
  exception when others then null; end;

  return json_build_object('ok', true);
end; $$;
grant execute on function public.cancel_application(uuid) to authenticated;