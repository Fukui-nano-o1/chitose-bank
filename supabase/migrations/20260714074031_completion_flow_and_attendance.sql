-- 完了フロー凍結版：相互承認（ダブルタップ）・緊急対応・欠勤申告＋異議・9時確認×2・7日自動完了
alter table public.applications
  add column if not exists farmer_confirmed_start_at timestamptz,  -- 農家の開始裏書き
  add column if not exists attended boolean,                        -- null=未判定/true=出勤/false=欠勤申告
  add column if not exists completion_remind_count int not null default 0,
  add column if not exists auto_completed boolean not null default false;

-- 緊急対応・異議の記録（全部運営が保存＝実績台帳①②の原料）
create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id),
  actor_id uuid not null,
  kind text not null check (kind in ('late','absent_notice','cancel','postpone','dispute_no_show','other')),
  reason text,
  created_at timestamptz not null default now()
);
alter table public.attendance_events enable row level security;
create policy "att insert party" on public.attendance_events
  for insert to authenticated
  with check (actor_id = auth.uid() and exists (
    select 1 from public.applications a where a.id = application_id
      and (a.worker_id = auth.uid() or a.farmer_id = auth.uid())));
create policy "att select party" on public.attendance_events
  for select to authenticated
  using (exists (select 1 from public.applications a where a.id = application_id
      and (a.worker_id = auth.uid() or a.farmer_id = auth.uid())));

-- 緊急イベント→相手方＋運営へ即時通知
create or replace function public.trg_notify_attendance()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_w uuid; v_f uuid; v_job int; v_to uuid; v_label text;
begin
  select worker_id, farmer_id, job_number into v_w, v_f, v_job
    from public.applications where id = new.application_id;
  v_to := case when new.actor_id = v_w then v_f else v_w end;
  v_label := case new.kind when 'late' then '遅れる連絡' when 'absent_notice' then '欠勤の連絡'
    when 'cancel' then '中止の連絡' when 'postpone' then '延期の連絡'
    when 'dispute_no_show' then '欠勤記録への異議' else '連絡' end;
  insert into public.notifications (farmer_id, type, message)
  values (v_to, 'attendance_' || new.kind,
          v_label || '：求人 #' || v_job || '　' || coalesce(left(new.reason,40),''));
  begin
    perform public.send_user_email(v_to,
      '[chitose-bank] ' || v_label || '：求人 #' || v_job,
      '相手方から' || v_label || 'がありました。' || E'\n' ||
      '理由：' || coalesce(new.reason,'（記載なし）') || E'\n\n' ||
      'チャット：https://chitose-bank.com/#/chats');
  exception when others then null; end;
  perform public.notify_admins('attendance_' || new.kind,
    v_label || '：求人 #' || v_job);
  return new;
end; $$;
drop trigger if exists notify_attendance on public.attendance_events;
create trigger notify_attendance after insert on public.attendance_events
  for each row execute function public.trg_notify_attendance();

-- 農家の開始裏書き（ダブルタップ握手の後半）
create or replace function public.confirm_start(p_application_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_f uuid;
begin
  select farmer_id into v_f from public.applications where id = p_application_id;
  if v_f is null then return json_build_object('ok', false, 'reason','not_found'); end if;
  if v_f <> auth.uid() then return json_build_object('ok', false, 'reason','not_yours'); end if;
  update public.applications
     set farmer_confirmed_start_at = coalesce(farmer_confirmed_start_at, now())
   where id = p_application_id;
  return json_build_object('ok', true);
end; $$;
grant execute on function public.confirm_start(uuid) to authenticated;

-- 完了処理（農家・出欠申告つき）。欠勤申告時は働き手に異議案内を自動送付（72時間窓）
create or replace function public.complete_work(p_application_id uuid, p_attended boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_f uuid; v_w uuid; v_job int; v_status text;
begin
  select farmer_id, worker_id, job_number, status into v_f, v_w, v_job, v_status
    from public.applications where id = p_application_id;
  if v_f is null then return json_build_object('ok', false, 'reason','not_found'); end if;
  if v_f <> auth.uid() then return json_build_object('ok', false, 'reason','not_yours'); end if;
  if v_status = 'completed' then return json_build_object('ok', true, 'already', true); end if;

  update public.applications
     set status = 'completed', attended = p_attended,
         work_completed_at = coalesce(work_completed_at, now())
   where id = p_application_id;

  if p_attended then
    begin
      perform public.send_user_email(v_w,
        '[chitose-bank] お疲れさまでした：求人 #' || v_job,
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
        '農家により欠勤が記録されました。' || E'\n' ||
        '心当たりがない場合は、72時間以内にアプリから異議申立ができます。' || E'\n' ||
        '（承認済みタブ → 該当の仕事 → 異議申立）' || E'\n\n' ||
        'https://chitose-bank.com');
    exception when others then null; end;
    perform public.notify_admins('no_show_recorded', '欠勤記録：求人 #' || v_job || '（異議窓72時間）');
  end if;

  return json_build_object('ok', true);
end; $$;
grant execute on function public.complete_work(uuid, boolean) to authenticated;

-- 毎朝9:00 JST：完了確認×最大2回＋7日で自動completed（評価権は3日ルールで自然消滅）
create or replace function public.send_completion_confirmations()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  for r in
    select a.id, a.farmer_id, a.job_number, a.completion_remind_count,
           coalesce(j.date_end, j.date_start) as last_day, j.crop, j.task
      from public.applications a
      join public.jobs j on j.job_number = a.job_number
     where a.status in ('approved','meeting','interview','contracted','working')
       and coalesce(j.date_end, j.date_start) < v_today
  loop
    if v_today - r.last_day >= 7 then
      update public.applications
         set status='completed', auto_completed=true,
             work_completed_at = coalesce(work_completed_at, now())
       where id = r.id;
    elsif r.completion_remind_count < 2 then
      begin
        perform public.send_user_email(r.farmer_id,
          '[chitose-bank] 作業は終わりましたか？：求人 #' || r.job_number,
          '求人 #' || r.job_number || '（' || coalesce(r.crop,'') || ' ' || coalesce(r.task,'') || '）の' ||
          '作業日が過ぎています。' || E'\n' ||
          '「完了して評価する」をお願いします（評価は完了から3日以内）。' || E'\n\n' ||
          'https://chitose-bank.com/#/profile/employer/applicants');
      exception when others then null; end;
      update public.applications
         set completion_remind_count = completion_remind_count + 1
       where id = r.id;
    end if;
  end loop;
end; $$;

select cron.schedule('completion-confirm', '0 0 * * *', $$ select public.send_completion_confirmations(); $$);
-- 0:00 UTC = 9:00 JST きっかり