-- 評価フローの分割（2026-08-19たきと指示）：最終作業日＝全体の評価（全工程の終了）／
-- それ以外の作業日＝その日の記録（遅刻・欠勤・相手が来ない）。
-- 「その日の記録」は attendance_events に入るので、どの作業日の記録かを持たせる。
-- ★既存の1行（異議申立）は work_date=null のまま＝過去の記録は書き換えない。
alter table public.attendance_events add column if not exists work_date date;

comment on column public.attendance_events.work_date is
  'その記録が指す作業日（YYYY-MM-DD）。日をまたぐ求人で「何日の遅刻・欠勤か」を残すため。
   日を特定しない連絡（異議申立など）は null。';

-- 通知の言い回しを「誰が記録したか」で出し分ける。
-- 旧実装は kind だけで決めていたので、農家が働き手の遅刻を記録しても
-- 相手に「相手方から遅れる連絡がありました」と届いていた（向きが逆）。
create or replace function public.trg_notify_attendance()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_w uuid; v_f uuid; v_job int; v_to uuid; v_label text; v_viewer text; v_extra text := '';
        v_by_farmer boolean; v_day text := '';
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
    else '連絡' end;

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
          v_day || v_label || '：求人 #' || v_job || '　' || coalesce(left(new.reason,40),''));
  begin
    perform public.send_user_email(v_to,
      '[chitose-bank] ' || v_day || v_label || '：求人 #' || v_job,
      '■ ' || public.job_ref(v_job, v_viewer) || E'\n\n' ||
      '相手方から' || v_day || v_label || 'がありました。' || E'\n' ||
      '状況：' || coalesce(new.reason,'（記載なし）') || v_extra || E'\n\n' ||
      'チャット：https://chitose-bank.com/#/chats');
  exception when others then null; end;

  -- 運営への警報（会えない連絡は最優先種別として明示）
  perform public.notify_admins('attendance_' || new.kind,
    case when new.kind = 'no_show_report'
      then '🚨現地で会えない連絡：求人 #' || v_job || '（要フォロー：双方に電話）'
      else v_day || v_label || '：求人 #' || v_job end);
  return new;
end; $function$;
