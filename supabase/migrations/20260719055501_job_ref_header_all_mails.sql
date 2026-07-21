-- 全求人メールに標準ヘッダー：誰の求人か・タイトル（作物 作業）・#N・求人リンク。
-- 改訂原則：特定性は運ぶ（誰の/何の/#N/リンク）・機密は運ばない（町名・番地・集合場所）。件名は不変。

create or replace function public.job_ref(p_job int, p_viewer text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_crop text; v_task text; v_farmer uuid; v_farm text; v_title text;
begin
  select crop, task, farmer_id into v_crop, v_task, v_farmer
    from public.jobs where job_number = p_job;
  if v_farmer is null then return '求人 #' || p_job; end if;
  v_title := trim(coalesce(v_crop,'') || ' ' || coalesce(v_task,''));
  if v_title = '' then v_title := '内容未設定'; end if;
  if p_viewer = 'farmer' then
    return 'あなたの求人 #' || p_job || '「' || v_title || '」';
  else
    select nullif(farm_name,'') into v_farm from public.employer_profiles where auth_id = v_farmer;
    v_farm := coalesce(v_farm, public.resolve_actor_name(v_farmer), '農家');
    return v_farm || 'さんの求人 #' || p_job || '「' || v_title || '」';
  end if;
end; $$;

create or replace function public.job_link(p_job int)
returns text language sql immutable as
$$ select E'\n▶ 求人ページ：https://chitose-bank.com/#/work/job/' || p_job $$;

-- M01 公開（農家）
create or replace function public.trg_notify_job_published()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'open' or coalesce(old.status,'') = 'open' then return new; end if;
  insert into public.notifications (farmer_id, type, message)
  values (new.farmer_id, 'job_published', 'あなたの求人 #' || new.job_number || ' が公開されました');
  begin
    perform public.send_user_email(new.farmer_id,
      '[chitose-bank] あなたの求人 #' || new.job_number || ' が公開されました',
      '■ ' || public.job_ref(new.job_number,'farmer') || E'\n\n' ||
      '確認が完了し、公開されました。応募が入るとメールでお知らせします。' ||
      public.job_link(new.job_number));
  exception when others then null; end;
  return new;
end; $$;

-- M02 応募あり（農家）※HTMLはヘッダー行のみ追記
create or replace function public.trg_notify_application()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_nickname text; v_pr text; v_avatar text; v_pr_shown text; v_truncated boolean := false;
  v_text text; v_html text; v_ref text;
  v_link text := 'https://chitose-bank.com/#/profile/employer/applicants';
begin
  perform public.notify_admins('new_application', '応募が入りました：求人 #' || new.job_number);
  select wp.nickname, wp.pr, wp.avatar_url into v_nickname, v_pr, v_avatar
    from public.worker_profiles wp where wp.auth_id = new.worker_id;
  v_pr := coalesce(nullif(v_pr,''), '');
  if v_pr = '' then v_pr_shown := '自己紹介は未入力です';
  elsif char_length(v_pr) <= 60 then v_pr_shown := v_pr;
  else v_pr_shown := left(v_pr, ceil(char_length(v_pr) / 2.0)::int); v_truncated := true;
  end if;
  v_ref := public.job_ref(new.job_number,'farmer');

  v_text :=
    '■ ' || v_ref || ' に応募が入りました。' || E'\n\n' ||
    '■ 応募者：' || coalesce(nullif(v_nickname,''),'（名前未設定）') || E'\n' ||
    '■ 自己紹介：' || E'\n' || v_pr_shown ||
    case when v_truncated then E'…\n（続きはサイトで）' else '' end || E'\n\n' ||
    '承認・見送りはこちら：' || v_link || public.job_link(new.job_number);

  v_html :=
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
    || '<h2 style="font-size:17px;color:#222;">応募が入りました</h2>'
    || '<p style="font-size:13px;color:#717171;">' || public.h(v_ref)
    || '（' || to_char(now() at time zone 'Asia/Tokyo','MM/DD HH24:MI') || '）</p>'
    || '<div style="border:1px solid #EBEBEB;border-radius:12px;padding:16px;margin:12px 0;">'
    || case when coalesce(v_avatar,'') <> ''
         then '<img src="' || public.h(v_avatar) || '" width="56" style="width:56px;height:56px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:12px;" />'
         else '' end
    || '<span style="font-size:16px;font-weight:bold;color:#222;vertical-align:middle;">'
    || public.h(coalesce(nullif(v_nickname,''),'（名前未設定）')) || '</span>'
    || '<div style="font-size:13px;color:#222;white-space:pre-wrap;margin-top:10px;padding:10px 14px;background:#F7F7F7;border-radius:8px;">'
    || public.h(v_pr_shown)
    || case when v_truncated
         then '… <a href="' || v_link || '" style="color:#00A86B;font-weight:bold;text-decoration:none;">もっと見る</a>'
         else '' end
    || '</div></div>'
    || '<a href="' || v_link || '" style="display:inline-block;background:#00A86B;color:#fff;'
    || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
    || '承認・見送りのページを開く</a>'
    || '<p style="font-size:11px;color:#B0B0B0;margin-top:14px;">'
    || 'chitose-bankは場の提供のみを行い、採否には関与しません。</p></div>';

  begin
    perform public.send_user_email(new.farmer_id,
      '[chitose-bank] 応募が入りました：あなたの求人 #' || new.job_number, v_text, v_html);
  exception when others then null; end;
  return new;
end; $$;

-- M03/M04 承認・見送り（働き手）
create or replace function public.approve_application(p_application_id uuid, p_approve boolean)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid; v_farmer uuid; v_worker uuid; v_status text; v_job int; v_new text; v_ref text;
  v_link text := 'https://chitose-bank.com/#/profile/worker/approved';
begin
  v_caller := auth.uid();
  if v_caller is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  select farmer_id, worker_id, status, job_number
    into v_farmer, v_worker, v_status, v_job
    from public.applications where id = p_application_id;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_farmer <> v_caller then return json_build_object('ok', false, 'reason', 'not_your_application'); end if;
  if v_status <> 'applied' then return json_build_object('ok', false, 'reason', 'already_decided', 'status', v_status); end if;

  v_new := case when p_approve then 'approved' else 'rejected' end;
  update public.applications set status = v_new, decided_at = now() where id = p_application_id;
  v_ref := public.job_ref(v_job,'worker');

  if p_approve then
    insert into public.notifications (farmer_id, type, message)
    values (v_worker, 'application_approved',
            '応募が承認されました：求人 #' || v_job || '　チャットで日程を打ち合わせましょう');
    begin
      perform public.send_user_email(v_worker,
        '[chitose-bank] 応募が承認されました：求人 #' || v_job,
        '■ ' || v_ref || E'\n\n' ||
        '応募が承認されました。' || E'\n' ||
        'サイト内のチャットで、日程や集合場所を打ち合わせましょう。' || E'\n\n' ||
        '承認された応募とチャット：' || v_link || public.job_link(v_job));
    exception when others then null; end;
  else
    insert into public.notifications (farmer_id, type, message)
    values (v_worker, 'application_declined',
            '求人 #' || v_job || '：今回はご縁がありませんでした。他の求人もぜひご覧ください');
    begin
      perform public.send_user_email(v_worker,
        '[chitose-bank] 応募の結果について：求人 #' || v_job,
        '■ ' || v_ref || E'\n\n' ||
        '今回はご縁がありませんでした。ご応募ありがとうございました。' || E'\n\n' ||
        '募集の人数や日程の都合による見送りも多くあります。' || E'\n' ||
        'プロフィールを充実させると、承認されやすくなります。' || E'\n\n' ||
        '他の求人を見る：https://chitose-bank.com/#/search');
    exception when others then null; end;
  end if;
  return json_build_object('ok', true, 'status', v_new);
end; $$;

-- M05 取消（農家）
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
      '■ ' || public.job_ref(v_job,'farmer') || E'\n\n' ||
      v_name || 'さんが応募を取り消しました。' || E'\n' ||
      '（承認前の取り消しのため、対応は不要です）' || public.job_link(v_job));
  exception when others then null; end;
  return json_build_object('ok', true);
end; $$;

-- M06/M07 失効・督促
create or replace function public.expire_stale_applications()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  for r in
    select a.id, a.worker_id, a.farmer_id, a.job_number, j.date_start
      from public.applications a join public.jobs j on j.job_number = a.job_number
     where a.status = 'applied' and j.date_start <= v_today
  loop
    update public.applications set status = 'expired', decided_at = now() where id = r.id;
    insert into public.notifications (farmer_id, type, message)
    values (r.worker_id, 'application_expired',
            '求人 #' || r.job_number || '：判断されないまま作業日を迎えたため、応募は失効しました');
    begin
      perform public.send_user_email(r.worker_id,
        '[chitose-bank] 応募の失効について：求人 #' || r.job_number,
        '■ ' || public.job_ref(r.job_number,'worker') || E'\n\n' ||
        '求人者の判断がないまま作業日を迎えたため、応募は自動的に失効しました。' || E'\n' ||
        'お待たせしたまま結果を出せず、申し訳ありません。' || E'\n\n' ||
        'あなたの応募が放置されない仕組みづくりを続けます。' || E'\n' ||
        '他の求人を見る：https://chitose-bank.com/#/search');
    exception when others then null; end;
  end loop;

  for r in
    select distinct a.farmer_id, a.job_number, j.date_start
      from public.applications a join public.jobs j on j.job_number = a.job_number
     where a.status = 'applied' and j.date_start = v_today + 1
  loop
    begin
      perform public.send_user_email(r.farmer_id,
        '[chitose-bank] 応募への返答をお願いします：求人 #' || r.job_number || '（明日開始）',
        '■ ' || public.job_ref(r.job_number,'farmer') || E'\n\n' ||
        'まだ返答していない応募があります。作業は明日です。' || E'\n' ||
        '承認または見送りの判断をお願いします。' || E'\n' ||
        '判断がないまま作業日を迎えると、応募は自動的に失効します。' || E'\n\n' ||
        'https://chitose-bank.com/#/profile/employer/applicants' || public.job_link(r.job_number));
    exception when others then null; end;
  end loop;
end; $$;

-- M08 保険リマインダー（農家）
create or replace function public.send_insurance_reminders()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_today date := (now() at time zone 'Asia/Tokyo')::date; v_days int; v_should boolean;
begin
  for r in
    select a.id, a.farmer_id, a.job_number,
           a.insurance_first_mailed_at, a.insurance_last_mailed_on, j.date_start
      from public.applications a join public.jobs j on j.job_number = a.job_number
     where a.status in ('approved','meeting','interview','contracted','working')
       and a.insurance_prepared_at is null and j.date_start >= v_today
  loop
    v_days := r.date_start - v_today;
    v_should := (r.insurance_first_mailed_at is null) or v_days = 3 or v_days = 1;
    if v_should and (r.insurance_last_mailed_on is distinct from v_today) then
      begin
        perform public.send_user_email(r.farmer_id,
          '[chitose-bank] 保険のご準備を：あなたの求人 #' || r.job_number ||
            '（作業まであと' || v_days || '日）',
          '■ ' || public.job_ref(r.job_number,'farmer') || '（作業日：' || r.date_start || '）' || E'\n\n' ||
          '作業日までに、働き手のケガに備える保険（1日傷害保険等）のご準備をおすすめします。' || E'\n' ||
          '・多くの商品は【前日まで】の加入が必要です' || E'\n' ||
          '・夏場は【熱中症の補償の有無】を必ずご確認ください' || E'\n\n' ||
          '準備ができたら、応募者のページで「保険を準備した」を押してください。' || E'\n' ||
          '働き手に自動でお知らせが届きます。' || E'\n\n' ||
          'https://chitose-bank.com/#/profile/employer/applicants' || public.job_link(r.job_number));
        update public.applications
           set insurance_first_mailed_at = coalesce(insurance_first_mailed_at, now()),
               insurance_last_mailed_on = v_today
         where id = r.id;
      exception when others then null; end;
    end if;
  end loop;
end; $$;

-- M09 保険報告（働き手）
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
      '[chitose-bank] 保険の準備の報告がありました：求人 #' || v_job,
      '■ ' || public.job_ref(v_job,'worker') || E'\n\n' ||
      '農家から、作業中のケガに備える保険を準備したとの報告がありました' || E'\n' ||
      '（報告日時は記録されます）。' || E'\n\n' ||
      '保険の内容（種類・補償の範囲）が気になる時は、' || E'\n' ||
      'チャットで気軽に確認してください。聞くのは普通のことです。' || E'\n\n' ||
      'https://chitose-bank.com/#/chats' || public.job_link(v_job));
  exception when others then null; end;
  return json_build_object('ok', true);
end; $$;

-- M10 開始1時間前（双方・緊急リンク維持）
create or replace function public.send_job_start_reminders()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_start_min int; v_now_min int; v_link text;
begin
  v_now_min := (extract(hour from now() at time zone 'Asia/Tokyo')::int) * 60
             + (extract(minute from now() at time zone 'Asia/Tokyo')::int);
  for r in
    select j.job_number, j.work_time, j.farmer_id, a.id as app_id, a.worker_id
      from public.jobs j join public.applications a on a.job_number = j.job_number
     where j.status = 'open'
       and a.status in ('approved','meeting','interview','contracted','working')
       and (j.date_start = (now() at time zone 'Asia/Tokyo')::date
            or (j.date_end is not null
                and (now() at time zone 'Asia/Tokyo')::date between j.date_start and j.date_end))
       and j.work_time ~ '^\d{1,2}:\d{2}'
  loop
    v_start_min := split_part(split_part(r.work_time,'〜',1),':',1)::int * 60
                 + split_part(split_part(r.work_time,'〜',1),':',2)::int;
    if v_start_min - v_now_min between 60 and 119 then
      v_link := 'https://chitose-bank.com/#/emergency/' || r.app_id;
      perform public.send_user_email(r.worker_id,
        '[chitose-bank] まもなく作業開始：求人 #' || r.job_number || '（' || r.work_time || '）',
        '■ ' || public.job_ref(r.job_number,'worker') || '（' || r.work_time || '）' || E'\n\n' ||
        '作業が約1時間後に始まります。' || E'\n\n' ||
        '遅れそう・行けない・体調がすぐれない——そんな時は、下のリンクから' || E'\n' ||
        'そのまま緊急連絡を送れます（農家さんに即時に届きます）：' || E'\n' || v_link || E'\n\n' ||
        '・持ち物と集合場所は、確認カードでもう一度ご確認ください。' || E'\n' ||
        '・熱中症にご注意ください。水分を持って出かけましょう。');
      perform public.send_user_email(r.farmer_id,
        '[chitose-bank] まもなく作業開始：あなたの求人 #' || r.job_number || '（' || r.work_time || '）',
        '■ ' || public.job_ref(r.job_number,'farmer') || '（' || r.work_time || '）' || E'\n\n' ||
        '作業が約1時間後に始まります。' || E'\n\n' ||
        '中止・延期などの緊急連絡は、下のリンクからそのまま送れます' || E'\n' ||
        '（働き手に即時に届きます）：' || E'\n' || v_link || E'\n\n' ||
        '・作業内容・安全の説明の準備をお願いします。');
    end if;
  end loop;
end; $$;

-- M11 緊急連絡（相手方・立場で表示切替）
create or replace function public.trg_notify_attendance()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_w uuid; v_f uuid; v_job int; v_to uuid; v_label text; v_viewer text;
begin
  select worker_id, farmer_id, job_number into v_w, v_f, v_job
    from public.applications where id = new.application_id;
  v_to := case when new.actor_id = v_w then v_f else v_w end;
  v_viewer := case when v_to = v_f then 'farmer' else 'worker' end;
  v_label := case new.kind when 'late' then '遅れる連絡' when 'absent_notice' then '欠勤の連絡'
    when 'cancel' then '中止の連絡' when 'postpone' then '延期の連絡'
    when 'dispute_no_show' then '欠勤記録への異議' else '連絡' end;
  insert into public.notifications (farmer_id, type, message)
  values (v_to, 'attendance_' || new.kind,
          v_label || '：求人 #' || v_job || '　' || coalesce(left(new.reason,40),''));
  begin
    perform public.send_user_email(v_to,
      '[chitose-bank] ' || v_label || '：求人 #' || v_job,
      '■ ' || public.job_ref(v_job, v_viewer) || E'\n\n' ||
      '相手方から' || v_label || 'がありました。' || E'\n' ||
      '理由：' || coalesce(new.reason,'（記載なし）') || E'\n\n' ||
      'チャット：https://chitose-bank.com/#/chats');
  exception when others then null; end;
  perform public.notify_admins('attendance_' || new.kind, v_label || '：求人 #' || v_job);
  return new;
end; $$;

-- M12 完了確認（農家）
create or replace function public.send_completion_confirmations()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  for r in
    select a.id, a.farmer_id, a.job_number, a.completion_remind_count,
           coalesce(j.date_end, j.date_start) as last_day
      from public.applications a join public.jobs j on j.job_number = a.job_number
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
          '[chitose-bank] 作業は終わりましたか？：あなたの求人 #' || r.job_number,
          '■ ' || public.job_ref(r.job_number,'farmer') || E'\n\n' ||
          '作業日が過ぎています。「完了して評価する」をお願いします' || E'\n' ||
          '（評価は完了から3日以内）。' || E'\n\n' ||
          'https://chitose-bank.com/#/profile/employer/applicants');
      exception when others then null; end;
      update public.applications
         set completion_remind_count = completion_remind_count + 1 where id = r.id;
    end if;
  end loop;
end; $$;

-- M13/M14 完了・欠勤（働き手）
create or replace function public.complete_work(p_application_id uuid, p_attended boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_f uuid; v_w uuid; v_job int; v_status text; v_ref text;
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

-- M16 指名通知（働き手）
create or replace function public.trg_notify_roster()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_instant text;
begin
  if new.status <> 'open' or coalesce(old.status,'') = 'open' then return new; end if;
  v_instant := case when coalesce(new.instant_approve_repeat, false)
    then E'\nこの求人は、応募すると選考なしで即決になります。' else '' end;
  for r in
    select worker_id from public.repeat_roster
     where farmer_id = new.farmer_id and notify = true and worker_id <> new.farmer_id
  loop
    insert into public.notifications (farmer_id, type, message)
    values (r.worker_id, 'roster_new_job',
            '🌟あなたを「また呼びたい」と評価した農家さんの新しい求人：#' || new.job_number);
    begin
      perform public.send_user_email(r.worker_id,
        '[chitose-bank] 🌟あなたを「また呼びたい」と評価した農家さんの新しい求人です',
        '■ ' || public.job_ref(new.job_number,'worker') || v_instant || E'\n\n' ||
        '今すぐチェック：https://chitose-bank.com/#/work/job/' || new.job_number);
    exception when others then null; end;
  end loop;
  return new;
end; $$;

-- M17/M18 即決（双方）
create or replace function public.trg_instant_approve()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_instant boolean; v_want boolean;
begin
  if new.status <> 'applied' then return new; end if;
  select instant_approve_repeat into v_instant from public.jobs where job_number = new.job_number;
  if not coalesce(v_instant, false) then return new; end if;
  select exists (
    select 1 from public.reviews r
     where r.reviewer_id = new.farmer_id and r.reviewee_id = new.worker_id
       and r.direction = 'farmer_to_worker' and r.want_again = true
  ) into v_want;
  if not v_want then return new; end if;

  update public.applications set status = 'approved', decided_at = now() where id = new.id;

  insert into public.notifications (farmer_id, type, message) values
    (new.worker_id, 'application_approved',
     '🌟即決で承認されました：求人 #' || new.job_number || '　以前の評価により自動承認されています'),
    (new.farmer_id, 'application_approved',
     '🌟リピート即決：以前「また呼びたい」と評価した方の応募を自動承認しました（求人 #' || new.job_number || '）');
  begin
    perform public.send_user_email(new.worker_id,
      '[chitose-bank] 🌟即決で承認されました：求人 #' || new.job_number,
      '■ ' || public.job_ref(new.job_number,'worker') || E'\n\n' ||
      '応募が、即決で承認されました。' || E'\n' ||
      'この求人者から以前「また呼びたい」の評価を受けているため、選考なしで確定しています。' || E'\n\n' ||
      'チャットで日程を確認しましょう：https://chitose-bank.com/#/profile/worker/approved' ||
      public.job_link(new.job_number));
    perform public.send_user_email(new.farmer_id,
      '[chitose-bank] 🌟リピート即決のお知らせ：求人 #' || new.job_number,
      '■ ' || public.job_ref(new.job_number,'farmer') || E'\n\n' ||
      'あなたが以前「また呼びたい」と評価した方から応募があり、' || E'\n' ||
      '求人の設定に基づいて自動承認しました。' || E'\n\n' ||
      '応募者の確認：https://chitose-bank.com/#/profile/employer/applicants' ||
      public.job_link(new.job_number));
  exception when others then null; end;
  return new;
end; $$;

-- M19 評価祝賀（双方・求人ヘッダー追加）
create or replace function public.trg_review_celebration()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_counterpart_done boolean; v_body text; v_role_line text;
  v_job int; v_viewer text; v_ref text;
begin
  if not coalesce(new.want_again, false) then return new; end if;
  v_name := public.resolve_actor_name(new.reviewer_id);
  select job_number into v_job from public.applications where id = new.application_id;
  v_viewer := case new.direction when 'farmer_to_worker' then 'worker' else 'farmer' end;
  v_ref := case when v_job is null then '' else '■ ' || public.job_ref(v_job, v_viewer) || E'\n\n' end;

  select exists (
    select 1 from public.reviews r
     where r.application_id = new.application_id and r.reviewer_id = new.reviewee_id
  ) into v_counterpart_done;

  v_role_line := case new.direction
    when 'farmer_to_worker' then '「🌟また呼びたい」の評価です。あなたのプロフィールの実績になります。'
    else '「🌟また働きたい」の評価です。あなたの農園の信頼になります。' end;

  if v_counterpart_done then
    v_body := v_ref || 'おめでとうございます！' || v_name || 'さんからの評価を受け取りました。' || E'\n' ||
      v_role_line || E'\n\n' || '開いてみましょう：https://chitose-bank.com/#/profile';
  else
    v_body := v_ref || 'おめでとうございます！' || v_name || 'さんからの評価が届いています。' || E'\n' ||
      v_role_line || E'\n\n' ||
      'あなたも評価を送ると、お互いの評価が見られるようになります（完了から3日以内）。' || E'\n' ||
      '評価を送る：https://chitose-bank.com/#/profile';
  end if;

  insert into public.notifications (farmer_id, type, message)
  values (new.reviewee_id, 'review_received', '🌟 ' || v_name || 'さんからの評価を受け取りました');
  begin
    perform public.send_user_email(new.reviewee_id,
      '[chitose-bank] 🌟おめでとうございます！' || v_name || 'さんからの評価が届きました', v_body);
  exception when others then null; end;
  return new;
end; $$;

-- M20 メッセージ（相手方・立場で表示切替）
create or replace function public.trg_notify_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_worker uuid; v_farmer uuid; v_job int; v_recipient uuid; v_recent int;
  v_link text; v_viewer text; v_ref text;
begin
  select worker_id, farmer_id, job_number into v_worker, v_farmer, v_job
    from public.applications where id = new.application_id;
  if v_worker is null then return new; end if;
  v_recipient := case when new.sender_id = v_farmer then v_worker else v_farmer end;
  select count(*) into v_recent
    from public.messages
   where application_id = new.application_id and sender_id = new.sender_id
     and id <> new.id and created_at > now() - interval '30 minutes';
  if v_recent > 0 then return new; end if;

  v_link := 'https://chitose-bank.com/#/chat/' || new.application_id;
  v_viewer := case when v_recipient = v_farmer then 'farmer' else 'worker' end;
  v_ref := public.job_ref(v_job, v_viewer);

  insert into public.notifications (farmer_id, type, message)
  values (v_recipient, 'new_message',
          'メッセージが届きました：求人 #' || v_job || '　' || left(new.body, 20));
  begin
    perform public.send_user_email(v_recipient,
      '[chitose-bank] メッセージが届きました：求人 #' || v_job,
      '■ ' || v_ref || E'\n\n' ||
      'チャットに新しいメッセージが届きました。' || E'\n' ||
      left(new.body, 40) || case when char_length(new.body) > 40 then '…' else '' end || E'\n\n' ||
      'チャットを開く：' || v_link,
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
      || '<h2 style="font-size:16px;color:#222;">メッセージが届きました</h2>'
      || '<p style="font-size:12px;color:#717171;">' || public.h(v_ref) || '</p>'
      || '<div style="font-size:14px;color:#222;padding:12px 16px;background:#F7F7F7;border-radius:10px;white-space:pre-wrap;">'
      || public.h(left(new.body, 60)) || case when char_length(new.body) > 60 then '…' else '' end
      || '</div>'
      || '<a href="' || v_link || '" style="display:inline-block;margin-top:14px;background:#00A86B;color:#fff;'
      || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
      || 'チャットを開いて返信する</a></div>');
  exception when others then null; end;
  return new;
end; $$;

-- M21 求人修正（農家）
create or replace function public.request_job_revision(p_job_number int, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare v_farmer uuid; v_status text; v_ref text;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    return json_build_object('ok', false, 'reason', 'reason_required');
  end if;
  select farmer_id, status into v_farmer, v_status from public.jobs where job_number = p_job_number;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_status not in ('pending','open') then
    return json_build_object('ok', false, 'reason', 'not_revisable', 'status', v_status);
  end if;
  v_ref := public.job_ref(p_job_number,'farmer');
  update public.jobs set status = 'draft' where job_number = p_job_number;
  insert into public.notifications (farmer_id, type, message)
  values (v_farmer, 'job_revision_requested',
          'あなたの求人 #' || p_job_number || ' の修正をお願いします：' || p_reason);
  begin
    perform public.send_user_email(v_farmer,
      '[chitose-bank] あなたの求人 #' || p_job_number || ' の修正のお願い',
      '■ ' || v_ref || E'\n\n' ||
      '確認の結果、以下の点の修正をお願いすることになりました。' || E'\n\n' ||
      '■ 修正をお願いする点：' || E'\n' || p_reason || E'\n\n' ||
      '求人は「作成中」に戻しています。修正のうえ、もう一度掲載してください。' || E'\n' ||
      '（内容の正確な表示のためのお願いであり、採否には一切関与しません）' || E'\n\n' ||
      'https://chitose-bank.com/#/profile/employer');
  exception when others then null; end;
  return json_build_object('ok', true);
end; $$;