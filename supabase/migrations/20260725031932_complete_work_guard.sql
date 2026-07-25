-- complete_work にガード追加（2026-07-25たきと指示）
-- 背景：未来の求人（12月開始#1028等）を7月に完了記録できてしまい、承認すらない応募まで完了になった。
--       手動の complete_work だけが段階・日付を見ていなかった（自動完了cronは日付条件つき）。
-- ガード①：承認以降（approved〜working）のみ完了記録できる。applied/rejected/expiredは不可
-- ガード②：求人の作業開始日（date_start）を迎えるまで完了記録できない（JST日付で比較）
--           求人行が削除済み（孤児応募）の場合は日付判定をスキップ（従来どおり）
-- 既存データには影響しない前方ガード。本体は 20260719055501 の版（job_ref付きメール文面）を維持
create or replace function public.complete_work(p_application_id uuid, p_attended boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_f uuid; v_w uuid; v_job int; v_status text; v_ref text; v_date_start date;
begin
  select farmer_id, worker_id, job_number, status into v_f, v_w, v_job, v_status
    from public.applications where id = p_application_id;
  if v_f is null then return json_build_object('ok', false, 'reason','not_found'); end if;
  if v_f <> auth.uid() then return json_build_object('ok', false, 'reason','not_yours'); end if;
  if v_status = 'completed' then return json_build_object('ok', true, 'already', true); end if;

  -- ガード①：承認以降のみ（reasonは呼び出し側がそのままalert表示するため日本語で返す）
  if v_status not in ('approved','meeting','interview','contracted','working') then
    return json_build_object('ok', false, 'reason','この応募はまだ承認されていません。承認してから完了を記録してください');
  end if;
  -- ガード②：作業開始日前は完了記録不可
  select date_start into v_date_start from public.jobs where job_number = v_job;
  if v_date_start is not null and v_date_start > (now() at time zone 'Asia/Tokyo')::date then
    return json_build_object('ok', false, 'reason','この求人の作業開始日（' || to_char(v_date_start, 'MM/DD') || '）はまだ先です。作業日を迎えてから完了を記録してください');
  end if;

  update public.applications
     set status = 'completed', attended = p_attended,
         work_completed_at = coalesce(work_completed_at, now())
   where id = p_application_id;
  v_ref := public.job_ref(v_job,'worker');

  if p_attended then
    begin
      perform public.send_user_email(v_w,
        '[chitose-bank] お疲れさまでした：求人 #' || v_job,
        '■ ' || v_ref || E'\n\n' ||
        '作業お疲れさまでした。農家の評価にご協力ください（3日以内）。' || E'\n\n' ||
        'https://chitose-bank.com/#/profile/worker/approved');
    exception when others then null; end;
  else
    insert into public.notifications (farmer_id, type, message)
    values (v_w, 'no_show_recorded',
            '欠勤が記録されました：求人 #' || v_job || '　心当たりがない場合は72時間以内に異議申立ができます');
    begin
      perform public.send_user_email(v_w,
        '[chitose-bank] 欠勤が記録されました：求人 #' || v_job,
        '■ ' || v_ref || E'\n\n' ||
        '農家により欠勤が記録されました。' || E'\n' ||
        '心当たりがない場合は、72時間以内にアプリから異議申立ができます。' || E'\n' ||
        '（承認済みタブ → 該当の仕事 → 異議申立）' || E'\n\n' ||
        'https://chitose-bank.com');
    exception when others then null; end;
    perform public.notify_admins('no_show_recorded', '欠勤記録：求人 #' || v_job || '（異議窓72時間）');
  end if;
  return json_build_object('ok', true);
end; $$;
