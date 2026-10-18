-- Production function definitions and trigger metadata read 2026-10-18; no user rows.
CREATE OR REPLACE FUNCTION public.trg_notify_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_w uuid; v_f uuid; v_job int; v_to uuid; v_label text; v_viewer text; v_extra text := '';
        v_by_farmer boolean; v_day text := ''; v_detail text := ''; v_situation text;
begin
  select worker_id, farmer_id, job_number into v_w, v_f, v_job
    from public.applications where id = new.application_id;
  v_to := case when new.actor_id = v_w then v_f else v_w end;
  v_viewer := case when v_to = v_f then 'farmer' else 'worker' end;
  v_by_farmer := (new.actor_id = v_f);
  if new.work_date is not null then
    v_day := to_char(new.work_date, 'MM/DD') || 'の';
  end if;

  v_label := case new.kind
    when 'late' then case when v_by_farmer then '遅刻の記録' else '遅れる連絡' end
    when 'absent_notice' then case when v_by_farmer then '欠勤の記録' else '欠勤の連絡' end
    when 'cancel' then '中止の連絡'
    when 'postpone' then '延期の連絡'
    when 'dispute_no_show' then '欠勤記録への異議'
    when 'no_show_report' then '現地で会えない連絡'
    when 'plan_mismatch' then '「予定と違う」の記録'
    when 'work_incomplete' then case when v_by_farmer then '作業中断の記録' else '作業中断の連絡' end
    else '連絡' end;

  v_detail := case new.detail
    when 'content' then '【作業内容が違った】'
    when 'time' then '【時間が違った】'
    when 'place' then '【場所が違った】'
    when 'pay' then '【報酬・条件が違った】'
    when 'other' then '【その他の食い違い】'
    when 'stopped_early' then '【途中で終了した】'
    when 'could_not_work' then '【作業できなかった】'
    else '' end;
  v_situation := trim(both ' ' from v_detail || ' ' || coalesce(new.reason, ''));

  if new.kind = 'no_show_report' then
    v_extra := E'\n\n至急、チャットまたは電話で相手に連絡してください。' || E'\n' ||
               'この記録は日時とともに保存され、当事者間の話し合いの資料になります。';
  elsif v_by_farmer and new.kind in ('late','absent_notice') then
    -- その日の記録であって、作業全体の出欠ではないことを明示する（最終日の評価で決まる）
    v_extra := E'\n\nこれはその日の記録です。作業全体の完了と出欠は、最終作業日の評価で決まります。' || E'\n' ||
               '心当たりがない場合は、チャットで相手にご確認ください。';
  end if;

  insert into public.notifications (farmer_id, type, message)
  values (v_to, 'attendance_' || new.kind,
          v_day || v_label || '：求人 #' || v_job || '　' || left(v_situation, 40));
  begin
    perform public.send_user_email(v_to,
      '[chitose-bank] ' || v_day || v_label || '：求人 #' || v_job,
      '■ ' || public.job_ref(v_job, v_viewer) || E'\n\n' ||
      '相手方から' || v_day || v_label || 'がありました。' || E'\n' ||
      '状況：' || coalesce(nullif(v_situation, ''), '（記載なし）') || v_extra || E'\n\n' ||
      'チャット：https://chitose-bank.com/#/chats');
  exception when others then null; end;

  -- 運営を呼ぶのは重大イベントだけ（2026-08-21たきと裁定・全件通知は火災報知器になる）：
  -- ①現地で会えない ②欠勤記録への異議（規約第7条3＝運営が双方から事情を確認する義務）
  -- ③「予定と違う」のうち報酬・条件の相違。それ以外はDB保存＋相手方への通知のみ。
  -- 未払いの申告は reviews 側の trg_pay_incident_on_unpaid が別途起票・通知する。
  if new.kind = 'no_show_report' then
    perform public.notify_admins('attendance_no_show_report',
      '🚨現地で会えない連絡：求人 #' || v_job || '（要フォロー：双方に電話）');
  elsif new.kind = 'dispute_no_show' then
    perform public.notify_admins('attendance_dispute_no_show',
      v_day || '欠勤記録への異議：求人 #' || v_job || '（双方から事情の確認を）');
  elsif new.kind = 'plan_mismatch' and new.detail = 'pay' then
    perform public.notify_admins('attendance_plan_mismatch',
      '💰' || v_day || '報酬・条件の相違の記録：求人 #' || v_job || '（要確認）');
  end if;
  return new;
end; $function$;
CREATE TRIGGER notify_attendance AFTER INSERT ON public.attendance_events FOR EACH ROW EXECUTE FUNCTION trg_notify_attendance();
CREATE OR REPLACE FUNCTION public.assert_actor_not_moderated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and public.is_account_moderated(auth.uid()) then
    raise exception 'アカウントは停止中のため、この操作はできません。運営（t5fki6643qty@gmail.com）までご連絡ください。'
      using errcode = 'P0001';
  end if;
  return new;
end; $function$;
CREATE TRIGGER trg_a_block_moderated BEFORE INSERT OR UPDATE ON public.attendance_events FOR EACH ROW EXECUTE FUNCTION assert_actor_not_moderated();
