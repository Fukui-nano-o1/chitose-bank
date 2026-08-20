-- 各日の記録＝事実記録に徹する（2026-08-20たきと裁定「日次は事故ログ。最終日は評価」）。
-- 種別を2系統だけ追加する（これ以上、日次画面を太らせない・たきと指示）：
--   plan_mismatch   … 予定と違います（働き手のみ。求人票と現実の不一致＝プラットフォームの中核データ）
--   work_incomplete … 作業が途中で終了した・作業できなかった（両役割）
alter table public.attendance_events drop constraint if exists attendance_events_kind_check;
alter table public.attendance_events add constraint attendance_events_kind_check
  check (kind = any (array['late'::text, 'absent_notice'::text, 'cancel'::text, 'postpone'::text,
                           'dispute_no_show'::text, 'no_show_report'::text,
                           'plan_mismatch'::text, 'work_incomplete'::text]));

-- 何が違ったか／どう終わったかの内訳（選択式＝あとで集計できる構造化データ。自由記述に埋めない）
alter table public.attendance_events add column if not exists detail text;
alter table public.attendance_events drop constraint if exists attendance_events_detail_check;
alter table public.attendance_events add constraint attendance_events_detail_check
  check (detail is null or detail = any (array[
    'content'::text, 'time'::text, 'place'::text, 'pay'::text, 'other'::text,   -- plan_mismatch の内訳
    'stopped_early'::text, 'could_not_work'::text]));                           -- work_incomplete の内訳

comment on column public.attendance_events.detail is
  'kind の内訳（選択式）。plan_mismatch＝content/time/place/pay/other、work_incomplete＝stopped_early/could_not_work。
   求人票と現実の一致を集計するための構造化データ（自由記述 reason とは別）。';

-- 通知：新しい2種別のラベルと、内訳の日本語を状況の行に添える
create or replace function public.trg_notify_attendance()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  -- 運営への警報（会えない連絡は最優先種別として明示）
  perform public.notify_admins('attendance_' || new.kind,
    case when new.kind = 'no_show_report'
      then '🚨現地で会えない連絡：求人 #' || v_job || '（要フォロー：双方に電話）'
      else v_day || v_label || '：求人 #' || v_job end);
  return new;
end; $function$;
