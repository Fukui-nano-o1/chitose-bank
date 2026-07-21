-- 保険完了通知の文体を「宣言ベース」に修正（運営は未確認の事実を断定しない）
create or replace function public.confirm_insurance(p_application_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_caller uuid; v_farmer uuid; v_worker uuid; v_job int; v_prepared timestamptz;
begin
  v_caller := auth.uid();
  if v_caller is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  select farmer_id, worker_id, job_number, insurance_prepared_at
    into v_farmer, v_worker, v_job, v_prepared
    from public.applications where id = p_application_id;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_farmer <> v_caller then return json_build_object('ok', false, 'reason', 'not_yours'); end if;
  if v_prepared is not null then return json_build_object('ok', true, 'already', true); end if;

  update public.applications set insurance_prepared_at = now() where id = p_application_id;

  insert into public.notifications (farmer_id, type, message)
  values (v_worker, 'insurance_prepared',
          '求人 #' || v_job || '：農家から保険を準備したとの報告がありました');
  begin
    perform public.send_user_email(v_worker,
      '[chitose-bank] 保険の準備が完了しました：求人 #' || v_job,
      '求人 #' || v_job || ' の農家から、作業中のケガに備える保険を' || E'\n' ||
      '準備したとの報告がありました（報告日時は記録されます）。' || E'\n\n' ||
      '保険の内容（種類・補償の範囲）が気になる時は、' || E'\n' ||
      'チャットで気軽に確認してください。聞くのは普通のことです。' || E'\n\n' ||
      'https://chitose-bank.com/#/chats');
  exception when others then null; end;
  return json_build_object('ok', true);
end; $$;