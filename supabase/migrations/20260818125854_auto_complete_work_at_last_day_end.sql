-- 作業の自動完了（2026-08-18たきと指示「最終日の終了時間経過で完了。」）
--
-- 背景：status='working' は auto_start_work（最初の作業日の開始時刻）が立てるが、降ろす手は
-- 農家の完了記録（complete_work）しか無かった。複数日の採用だと、働いていない日も
-- 「作業中」と出続ける（たきと報告・実データ #1232＝働く日 8/18・20・21・24・31 で
-- 8/19・8/22-23・8/25-30 も作業中）。従来の自動完了は「最終作業日から7日後」
-- （send_completion_confirmations）＝遅すぎて、この期間をまるごと取りこぼしていた。
--
-- ■最終作業日 ＝ app_work_dates(応募) の最大日
--   （agreed_dates優先／無ければ求人範囲を展開／holidaysは除外）。
--   ＝二重予約の壁・カレンダーと同じ「働く日」の唯一のソースを使う＝数え方を増やさない。
-- ■終了時刻 ＝ jobs.work_time の右側（"6:00〜9:00" → 9:00）。
--   読めない・終了が開始以前（日またぎ等）ならその日の 23:59（JST）＝安全側に倒す
--   （auto_start_work が読めない開始を 6:00 と見なしたのと対）。
-- ■attended（出欠）は触らない＝憶測で出欠を作らない（2026-08-05「憶測で遅刻にしない」と同じ）。
--   自動完了が「働き手が来なかった」の記録窓口（2026-07-30たきと指摘で作った導線）を奪わないよう、
--   下の complete_work 改修で「自動完了かつ出欠が空」の間は農家が出欠を記録できるようにする。
-- ■記録の憲法：誰の操作かを残す＝auto_completed=true。work_completed_at は最終日の終了時刻へ
--   バックデート（auto_start_work が started_at を v_due に置いたのと同じ作法）。
-- ■判定はすべて日本時間（cronはUTCで回る）。
create or replace function public.auto_complete_work()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
  r record; v_last date; v_start_txt text; v_end_txt text;
  v_h int; v_m int; v_smin int; v_emin int; v_due timestamptz; v_n int := 0;
begin
  for r in
    select a.id, j.work_time
      from public.applications a
      join public.jobs j on j.job_number = a.job_number
     where a.status = 'working'
  loop
    select max(d) into v_last from public.app_work_dates(r.id) d;
    if v_last is null then continue; end if; -- 働く日が分からない＝憶測で閉じない（7日ルールが受け持つ）

    v_start_txt := substring(coalesce(r.work_time, '') from '^[[:space:]]*([0-9]{1,2}:[0-9]{2})');
    v_end_txt   := substring(coalesce(r.work_time, '') from '([0-9]{1,2}:[0-9]{2})[[:space:]]*$');
    v_h := 23; v_m := 59;
    if v_end_txt is not null then
      v_emin := split_part(v_end_txt, ':', 1)::int * 60 + split_part(v_end_txt, ':', 2)::int;
      v_smin := case when v_start_txt is null then -1
                     else split_part(v_start_txt, ':', 1)::int * 60 + split_part(v_start_txt, ':', 2)::int end;
      -- 終了が読めて、開始より後で、時刻として正しい時だけ採用する
      if v_emin > v_smin and v_emin <= 23 * 60 + 59 then
        v_h := v_emin / 60; v_m := v_emin % 60;
      end if;
    end if;

    v_due := ((v_last::text || ' ' || lpad(v_h::text, 2, '0') || ':' || lpad(v_m::text, 2, '0'))::timestamp)
             at time zone 'Asia/Tokyo';
    if v_now >= v_due then
      update public.applications
         set status = 'completed', auto_completed = true,
             work_completed_at = coalesce(work_completed_at, v_due)
       where id = r.id and status = 'working';
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$function$;

-- cronだけが撃つ（クライアントからは実行させない・2026-08-06の裏方revokeと同じ作法。
-- ★revokeは from public が必須＝関数作成時のPUBLIC自動付与は from anon,authenticated では落ちない）
revoke all on function public.auto_complete_work() from public, anon, authenticated;

-- 毎時20分（開始の auto-start-work=毎時5分とぶつけない）。終了時刻から最大1時間で完了になる
select cron.unschedule('auto-complete-work') where exists (select 1 from cron.job where jobname = 'auto-complete-work');
select cron.schedule('auto-complete-work', '20 * * * *', $$ select public.auto_complete_work(); $$);

-- ── 完了後の出欠の記録（2026-08-18）──
-- 自動完了で status='completed' になった行は、出欠がまだ空（attended is null）の間だけ、
-- 農家が出欠（来た／来なかった）を記録できる。自動完了が欠勤の記録窓口を奪わないため。
-- 農家自身が記録した完了（auto_completed=false）は従来どおり already で返す＝記録を上書きさせない。
-- ★本番の現定義を土台に、その1点だけを足している（2026-08-06の教訓「作り直す時は今の本番の定義を土台にする」）
create or replace function public.complete_work(p_application_id uuid, p_attended boolean)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_f uuid; v_w uuid; v_job int; v_status text; v_ref text; v_date_start date;
        v_auto boolean; v_att boolean;
begin
  select farmer_id, worker_id, job_number, status, auto_completed, attended
    into v_f, v_w, v_job, v_status, v_auto, v_att
    from public.applications where id = p_application_id;
  if v_f is null then return json_build_object('ok', false, 'reason','not_found'); end if;
  if v_f <> auth.uid() then return json_build_object('ok', false, 'reason','not_yours'); end if;
  if v_status = 'completed' and not (coalesce(v_auto, false) and v_att is null) then
    return json_build_object('ok', true, 'already', true);
  end if;

  if v_status not in ('approved','meeting','interview','contracted','working','completed') then
    return json_build_object('ok', false, 'reason','この応募はまだ承認されていません。承認してから完了を記録してください');
  end if;
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
end; $function$;
grant execute on function public.complete_work(uuid, boolean) to authenticated;
