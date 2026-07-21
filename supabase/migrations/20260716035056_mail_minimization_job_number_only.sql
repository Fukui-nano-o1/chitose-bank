-- メール最小化：作物・作業・地名をメールから除去し「あなたの求人 #N」「求人 #N」に統一。
-- 詳細は全てリンク先（RLS内）で確認させる。日時・時刻は運用上必要なため残す。

-- 1) 公開のお知らせ
create or replace function public.trg_notify_job_published()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'open' or coalesce(old.status,'') = 'open' then return new; end if;
  insert into public.notifications (farmer_id, type, message)
  values (new.farmer_id, 'job_published',
          'あなたの求人 #' || new.job_number || ' が公開されました');
  begin
    perform public.send_user_email(new.farmer_id,
      '[chitose-bank] あなたの求人 #' || new.job_number || ' が公開されました',
      'あなたの求人 #' || new.job_number || ' の確認が完了し、公開されました。' || E'\n\n' ||
      '応募が入ると、メールでお知らせします。' || E'\n' ||
      '内容の確認：https://chitose-bank.com/#/work/job/' || new.job_number);
  exception when others then null; end;
  return new;
end; $$;

-- 2) 求人修正のお願い
create or replace function public.request_job_revision(p_job_number int, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare v_farmer uuid; v_status text;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    return json_build_object('ok', false, 'reason', 'reason_required');
  end if;
  select farmer_id, status into v_farmer, v_status
    from public.jobs where job_number = p_job_number;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_status not in ('pending','open') then
    return json_build_object('ok', false, 'reason', 'not_revisable', 'status', v_status);
  end if;
  update public.jobs set status = 'draft' where job_number = p_job_number;
  insert into public.notifications (farmer_id, type, message)
  values (v_farmer, 'job_revision_requested',
          'あなたの求人 #' || p_job_number || ' の修正をお願いします：' || p_reason);
  begin
    perform public.send_user_email(v_farmer,
      '[chitose-bank] あなたの求人 #' || p_job_number || ' の修正のお願い',
      'あなたの求人 #' || p_job_number || ' について、' || E'\n' ||
      '確認の結果、以下の点の修正をお願いすることになりました。' || E'\n\n' ||
      '■ 修正をお願いする点：' || E'\n' || p_reason || E'\n\n' ||
      '求人は「作成中」に戻しています。修正のうえ、もう一度掲載してください。' || E'\n' ||
      '（内容の正確な表示のためのお願いであり、採否には一切関与しません）' || E'\n\n' ||
      'https://chitose-bank.com/#/profile/employer');
  exception when others then null; end;
  return json_build_object('ok', true);
end; $$;

-- 3) 保険リマインダー（crop/task除去・日付は残す）
create or replace function public.send_insurance_reminders()
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_days int; v_should boolean;
begin
  for r in
    select a.id, a.farmer_id, a.job_number,
           a.insurance_first_mailed_at, a.insurance_last_mailed_on, j.date_start
      from public.applications a
      join public.jobs j on j.job_number = a.job_number
     where a.status in ('approved','meeting','interview','contracted','working')
       and a.insurance_prepared_at is null
       and j.date_start >= v_today
  loop
    v_days := r.date_start - v_today;
    v_should := (r.insurance_first_mailed_at is null) or v_days = 3 or v_days = 1;
    if v_should and (r.insurance_last_mailed_on is distinct from v_today) then
      begin
        perform public.send_user_email(r.farmer_id,
          '[chitose-bank] 保険のご準備を：あなたの求人 #' || r.job_number ||
            '（作業まであと' || v_days || '日）',
          'あなたの求人 #' || r.job_number || '（作業日：' || r.date_start || '）が近づいています。' || E'\n\n' ||
          '作業日までに、働き手のケガに備える保険（1日傷害保険等）のご準備をおすすめします。' || E'\n' ||
          '・多くの商品は【前日まで】の加入が必要です' || E'\n' ||
          '・夏場は【熱中症の補償の有無】を必ずご確認ください' || E'\n\n' ||
          '準備ができたら、応募者のページで「保険を準備した」を押してください。' || E'\n' ||
          '働き手に自動でお知らせが届きます。' || E'\n\n' ||
          'https://chitose-bank.com/#/profile/employer/applicants');
        update public.applications
           set insurance_first_mailed_at = coalesce(insurance_first_mailed_at, now()),
               insurance_last_mailed_on = v_today
         where id = r.id;
      exception when others then null; end;
    end if;
  end loop;
end; $$;

-- 4) 開始1時間前（crop/task/town除去・時刻は残す・緊急リンク維持）
create or replace function public.send_job_start_reminders()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_start_min int; v_now_min int; v_link text;
begin
  v_now_min := (extract(hour from now() at time zone 'Asia/Tokyo')::int) * 60
             + (extract(minute from now() at time zone 'Asia/Tokyo')::int);
  for r in
    select j.job_number, j.work_time, j.farmer_id, a.id as app_id, a.worker_id
      from public.jobs j
      join public.applications a on a.job_number = j.job_number
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
        '本日の求人 #' || r.job_number || '（' || r.work_time || '）の作業が約1時間後に始まります。' || E'\n\n' ||
        '遅れそう・行けない・体調がすぐれない——そんな時は、下のリンクから' || E'\n' ||
        'そのまま緊急連絡を送れます（農家さんに即時に届きます）：' || E'\n' ||
        v_link || E'\n\n' ||
        '・持ち物と集合場所は、確認カードでもう一度ご確認ください。' || E'\n' ||
        '・熱中症にご注意ください。水分を持って出かけましょう。');
      perform public.send_user_email(r.farmer_id,
        '[chitose-bank] まもなく作業開始：あなたの求人 #' || r.job_number || '（' || r.work_time || '）',
        'あなたの求人 #' || r.job_number || '（' || r.work_time || '）の作業が約1時間後に始まります。' || E'\n\n' ||
        '中止・延期などの緊急連絡は、下のリンクからそのまま送れます' || E'\n' ||
        '（働き手に即時に届きます）：' || E'\n' ||
        v_link || E'\n\n' ||
        '・作業内容・安全の説明の準備をお願いします。');
    end if;
  end loop;
end; $$;

-- 5) 完了確認（crop/task除去）
create or replace function public.send_completion_confirmations()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  for r in
    select a.id, a.farmer_id, a.job_number, a.completion_remind_count,
           coalesce(j.date_end, j.date_start) as last_day
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
          '[chitose-bank] 作業は終わりましたか？：あなたの求人 #' || r.job_number,
          'あなたの求人 #' || r.job_number || ' の作業日が過ぎています。' || E'\n' ||
          '「完了して評価する」をお願いします（評価は完了から3日以内）。' || E'\n\n' ||
          'https://chitose-bank.com/#/profile/employer/applicants');
      exception when others then null; end;
      update public.applications
         set completion_remind_count = completion_remind_count + 1
       where id = r.id;
    end if;
  end loop;
end; $$;

-- 6) 指名リスト通知（crop/task除去・農家名は残す＝訴求の核）
create or replace function public.trg_notify_roster()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_farm text; v_instant text;
begin
  if new.status <> 'open' or coalesce(old.status,'') = 'open' then return new; end if;
  v_farm := public.resolve_actor_name(new.farmer_id);
  v_instant := case when coalesce(new.instant_approve_repeat, false)
    then E'\nこの求人は、応募すると選考なしで即決になります。' else '' end;
  for r in
    select worker_id from public.repeat_roster
     where farmer_id = new.farmer_id and notify = true
       and worker_id <> new.farmer_id
  loop
    insert into public.notifications (farmer_id, type, message)
    values (r.worker_id, 'roster_new_job',
            '🌟あなたを「また呼びたい」と評価した農家さんの新しい求人：#' || new.job_number);
    begin
      perform public.send_user_email(r.worker_id,
        '[chitose-bank] 🌟あなたを「また呼びたい」と評価した農家さんの新しい求人です',
        v_farm || 'さんが、新しい求人 #' || new.job_number || ' を出しました。' ||
        v_instant || E'\n\n' ||
        '今すぐチェック：https://chitose-bank.com/#/work/job/' || new.job_number);
    exception when others then null; end;
  end loop;
  return new;
end; $$;

-- 7) 応募あり（crop/task除去・応募者名とPRは判断材料として維持）
create or replace function public.trg_notify_application()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_nickname text; v_pr text; v_avatar text;
  v_pr_shown text; v_truncated boolean := false;
  v_text text; v_html text;
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

  v_text :=
    'あなたの求人 #' || new.job_number || ' に応募が入りました。' || E'\n\n' ||
    '■ 応募者：' || coalesce(nullif(v_nickname,''),'（名前未設定）') || E'\n' ||
    '■ 自己紹介：' || E'\n' || v_pr_shown ||
    case when v_truncated then E'…\n（続きはサイトで）' else '' end || E'\n\n' ||
    '承認・見送りはこちら：' || v_link;

  v_html :=
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
    || '<h2 style="font-size:17px;color:#222;">応募が入りました</h2>'
    || '<p style="font-size:13px;color:#717171;">あなたの求人 #' || new.job_number
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
    || '承認すると、応募者にお知らせが届き、チャットで日程を打ち合わせられます。<br/>'
    || 'chitose-bankは場の提供のみを行い、採否には関与しません。</p></div>';

  begin
    perform public.send_user_email(
      new.farmer_id,
      '[chitose-bank] 応募が入りました：あなたの求人 #' || new.job_number,
      v_text, v_html);
  exception when others then null;
  end;
  return new;
end; $$;