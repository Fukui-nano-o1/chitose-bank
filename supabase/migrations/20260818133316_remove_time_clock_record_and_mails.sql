-- 打刻の全面削除（2026-08-18 たきと指示）
--
-- 【範囲】① 働き手の打刻（punch_start・圏外キュー・打刻の時間窓）
--         ② 打刻の修正申請（attendance_corrections・request/decide_time_correction）
--         ③ 相方の署名（confirm_start＝農家の開始確認／confirm_end＝働き手の終了確認）
-- 【残すもの】④ 自動開始（cron auto-start-work → started_at・auto_started・status='working'）
--             ＝作業日の開始時刻を過ぎると自動で「作業中」になる流れは不変。
-- 【列】started_at / farmer_confirmed_start_at / worker_confirmed_end_at / auto_started /
--       started_declared / ended_declared / time_corrected は DROP しない
--       （たきと裁定「列は残し、読み書きをやめる」＝過去の記録は消さない・記録の憲法）。
--       以後 farmer_confirmed_start_at・worker_confirmed_end_at・started_declared・
--       ended_declared・time_corrected に書き込む経路は無くなる。
--
-- 【attendance_events は対象外】名前が似ているが打刻ではない＝遅れる連絡・欠勤の連絡・中止・延期・
--   欠勤記録への異議・現地で会えない連絡（緊急連絡の台帳）。そのまま残す。

-- ── はたらいた記録：遅刻の判定をやめる ──────────────────────
-- 打刻が無くなると started_at は必ず自動開始の時刻＝そこから遅刻を導くと憶測になる
-- （2026-08-05の裁定「自動開始・打刻なしの回は遅刻判定しない＝記録なしに倒す」の行き着く先）。
-- 数えるのは記録として残る欠勤（attended=false）だけ。回数・時間・作物別・作業別は不変。
create or replace function public.worker_work_record(p_worker_id uuid)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_worker json; v_recent json; v_by_crop json; v_by_task json;
  v_count int; v_absent int; v_minutes int; v_unknown int;
  v_admin boolean; v_self boolean; v_detail boolean;
begin
  if auth.uid() is null or p_worker_id is null then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;
  v_admin := exists (select 1 from public.app_admins a where a.auth_id = auth.uid());
  v_self  := (auth.uid() = p_worker_id);
  if not v_admin and not v_self and not exists (
    select 1 from public.applications a
    where a.worker_id = p_worker_id and a.farmer_id = auth.uid()
  ) then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;
  v_detail := (v_admin or v_self);

  select json_build_object('worker_id', p_worker_id, 'name', wp.nickname)
    into v_worker
    from public.worker_profiles wp where wp.auth_id = p_worker_id;
  if v_worker is null then
    v_worker := json_build_object('worker_id', p_worker_id, 'name', null);
  end if;

  select count(*) filter (where a.attended is distinct from false),
         count(*) filter (where a.attended is false),
         coalesce(sum(public.job_scheduled_minutes(j.work_time))
                  filter (where a.attended is distinct from false), 0)::int,
         count(*) filter (where a.attended is distinct from false
                            and public.job_scheduled_minutes(j.work_time) is null)
    into v_count, v_absent, v_minutes, v_unknown
    from public.applications a
    left join public.jobs j on j.job_number = a.job_number
   where a.worker_id = p_worker_id and a.status = 'completed';

  select coalesce(json_agg(row order by ord desc nulls last), '[]'::json) into v_recent
  from (
    select json_build_object(
             'application_id', a.id,
             'job_number', case when v_detail then a.job_number end,
             'crop', case when v_detail then j.crop end,
             'task', case when v_detail then j.task end,
             'work_date', to_char(coalesce(a.work_completed_at at time zone 'Asia/Tokyo',
                                           a.started_at at time zone 'Asia/Tokyo',
                                           j.date_start::timestamp), 'YYYY/MM/DD'),
             'attended', a.attended,
             'minutes', public.job_scheduled_minutes(j.work_time)
           ) as row,
           coalesce(a.work_completed_at, a.started_at, j.date_start::timestamptz) as ord
      from public.applications a
      left join public.jobs j on j.job_number = a.job_number
     where a.worker_id = p_worker_id and a.status = 'completed'
     order by ord desc nulls last
     limit 5
  ) t;

  select coalesce(json_agg(json_build_object('key', key, 'count', cnt, 'minutes', mins)
                  order by cnt desc, key asc), '[]'::json) into v_by_crop
  from (
    select coalesce(j.crop, '未設定') as key, count(*) as cnt,
           coalesce(sum(public.job_scheduled_minutes(j.work_time)), 0)::int as mins
      from public.applications a
      left join public.jobs j on j.job_number = a.job_number
     where a.worker_id = p_worker_id and a.status = 'completed'
       and a.attended is distinct from false
     group by 1
  ) t;

  select coalesce(json_agg(json_build_object('key', key, 'count', cnt, 'minutes', mins)
                  order by cnt desc, key asc), '[]'::json) into v_by_task
  from (
    select coalesce(j.task, '未設定') as key, count(*) as cnt,
           coalesce(sum(public.job_scheduled_minutes(j.work_time)), 0)::int as mins
      from public.applications a
      left join public.jobs j on j.job_number = a.job_number
     where a.worker_id = p_worker_id and a.status = 'completed'
       and a.attended is distinct from false
     group by 1
  ) t;

  return json_build_object('ok', true, 'worker', v_worker,
    'totals', json_build_object('completed_count', coalesce(v_count,0), 'absent_count', coalesce(v_absent,0),
                                'total_minutes', coalesce(v_minutes,0), 'unknown_time_count', coalesce(v_unknown,0)),
    'profile_view_count', case when v_detail then
      coalesce((select c.view_count from public.worker_profile_view_counts c where c.worker_id = p_worker_id), 0)
    end,
    'recent', v_recent, 'by_crop', v_by_crop, 'by_task', v_by_task);
end; $function$;

-- ── 当日のお知らせメール（M32・M33）から打刻の導線を外す ────────
-- M32（開始の時刻）農家：「開始を確認」は無くなった＝到着の確認を促し、行き先は今日の仕事
-- M33（終了の時刻）働き手：「終了を確認して評価する」→「農家を評価する」
create or replace function public.job_time_notice_mail(p_app uuid, p_kind text, p_role text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_job int; v_wt text; v_ref text; v_head text;
  v_subject text; v_body text; v_btn_label text; v_btn_url text; v_sub text := '';
  v_emg text;
begin
  select a.job_number, j.work_time into v_job, v_wt
    from public.applications a join public.jobs j on j.job_number = a.job_number
   where a.id = p_app;
  if v_job is null then return null; end if;

  v_emg  := 'https://chitose-bank.com/#/emergency/' || p_app;
  v_ref  := public.job_ref(v_job, p_role);
  v_head := '■ ' || v_ref || '（' || coalesce(v_wt,'時間未設定') || '）' || E'\n\n';

  if p_kind = 'before_60' and p_role = 'worker' then
    v_subject := '仕事開始まであと1時間です';
    v_body := '本日の仕事開始まであと1時間です。' || E'\n' ||
              '集合場所、持ち物、移動状況をご確認ください。' || E'\n\n' ||
              '遅れそうな場合や、予定どおり向かうことが難しい場合は、早めに農家へご連絡ください。';
    v_btn_label := '緊急連絡をする'; v_btn_url := v_emg;

  elsif p_kind = 'before_60' and p_role = 'farmer' then
    v_subject := '作業開始まであと1時間です';
    v_body := '本日の作業開始まであと1時間です。' || E'\n' ||
              '受け入れ準備、作業内容、集合場所をご確認ください。' || E'\n\n' ||
              '予定の変更や働き手への連絡が必要な場合は、早めにご連絡ください。';
    v_btn_label := '緊急連絡をする'; v_btn_url := v_emg;

  elsif p_kind = 'before_15' and p_role = 'worker' then
    v_subject := '仕事開始まであと15分です';
    v_body := 'まもなく仕事開始時刻です。' || E'\n' ||
              '現地への到着と作業準備をご確認ください。' || E'\n\n' ||
              '遅れる場合や到着できない場合は、すぐに農家へご連絡ください。';
    v_btn_label := '緊急連絡をする'; v_btn_url := v_emg;

  elsif p_kind = 'before_15' and p_role = 'farmer' then
    v_subject := '作業開始まであと15分です';
    v_body := 'まもなく作業開始時刻です。' || E'\n' ||
              '働き手の受け入れ準備をご確認ください。' || E'\n\n' ||
              '予定変更や緊急の連絡がある場合は、働き手へご連絡ください。';
    v_btn_label := '緊急連絡をする'; v_btn_url := v_emg;

  elsif p_kind = 'start' and p_role = 'worker' then
    v_subject := '仕事開始の時間です';
    v_body := '仕事の開始時刻になりました。' || E'\n' ||
              '開始時刻は自動で記録されます。' || E'\n\n' ||
              '作業内容と本日の予定をご確認のうえ、作業を開始してください。';
    v_btn_label := '今日の仕事を見る'; v_btn_url := 'https://chitose-bank.com/#/calendar';
    v_sub := '遅刻・中止などの連絡はこちら';

  elsif p_kind = 'start' and p_role = 'farmer' then
    v_subject := '仕事開始の時間です';
    v_body := '予定の仕事開始時刻になりました。' || E'\n' ||
              '開始の時刻は自動で記録されています。' || E'\n\n' ||
              '働き手が到着し、実際に作業を始めたことをご確認ください。' || E'\n' ||
              '働き手が来ていない場合は、作業のあとの完了の記録で「来なかった」として残せます。';
    v_btn_label := '今日の仕事を見る'; v_btn_url := 'https://chitose-bank.com/#/calendar';
    v_sub := '急ぎの連絡はこちら';

  elsif p_kind = 'end' and p_role = 'worker' then
    v_subject := '仕事終了の時間です｜評価をお願いします';
    v_body := '予定の仕事終了時刻になりました。' || E'\n\n' ||
              '作業お疲れさまでした。' || E'\n' ||
              '報酬は当日その場で現金でお受け取りください。' || E'\n\n' ||
              '最後に農家への評価をお願いします。';
    v_btn_label := '農家を評価する'; v_btn_url := 'https://chitose-bank.com/#/calendar/todo/w_review';

  elsif p_kind = 'end' and p_role = 'farmer' then
    v_subject := '仕事終了の時間です｜完了を確認してください';
    v_body := '予定の仕事終了時刻になりました。' || E'\n\n' ||
              '作業が終了したことをご確認ください。' || E'\n' ||
              '報酬は当日その場で現金でお渡しください。' || E'\n\n' ||
              '作業完了を記録し、働き手を評価してください。';
    v_btn_label := '完了して評価する'; v_btn_url := 'https://chitose-bank.com/#/calendar/todo/complete';

  else
    return null;
  end if;

  return jsonb_build_object(
    'subject', '[chitose-bank] ' || v_subject,
    'body', v_head || v_body || E'\n\n' || v_btn_label || '：' || E'\n' || v_btn_url ||
            case when v_sub <> '' then E'\n\n' || v_sub || '：' || E'\n' || v_emg else '' end,
    'html',
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
      || '<h2 style="font-size:17px;color:#222;">' || public.h(v_subject) || '</h2>'
      || '<p style="font-size:13px;color:#717171;">' || public.h(v_ref)
      || '（' || public.h(coalesce(v_wt,'時間未設定')) || '）</p>'
      || '<p style="font-size:14px;color:#222;line-height:1.9;white-space:pre-wrap;margin:12px 0 20px;">'
      || public.h(v_body) || '</p>'
      || '<a href="' || v_btn_url || '" style="display:inline-block;background:#00A86B;color:#fff;'
      || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
      || public.h(v_btn_label) || '</a>'
      || case when v_sub <> '' then
           '<p style="font-size:12px;margin:16px 0 0;"><a href="' || v_emg
           || '" style="color:#717171;text-decoration:underline;">' || public.h(v_sub) || '</a></p>'
         else '' end
      || '</div>');
end $function$;

-- ── 当日のお知らせの送信条件から打刻の署名時刻を外す ─────────────
-- ・start × farmer：開始確認の時刻を見ていた → 廃止したので常に送る（完了済みは外側のwhereが弾く）
-- ・end   × worker：終了確認の時刻を見ていた → 評価の行の有無で見る（記録から導出）
-- ・before_60 / before_15 の「すでに始まっている時は送らない」は started_at（自動開始）で不変
create or replace function public.send_job_time_notices()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
  v_today date; v_now_min int;
  v_start_min int; v_end_min int;
  v_kind text; v_role text; v_target int; v_ins int; v_ok boolean;
  v_to uuid; v_mail jsonb; v_req bigint;
begin
  perform public.resolve_job_time_notice_delivery();

  v_today   := (now() at time zone 'Asia/Tokyo')::date;
  v_now_min := (extract(hour   from now() at time zone 'Asia/Tokyo')::int) * 60
             + (extract(minute from now() at time zone 'Asia/Tokyo')::int);

  for r in
    select a.id as app_id, a.worker_id, a.farmer_id, j.work_time,
           a.started_at, a.work_completed_at, a.attended
      from public.applications a
      join public.jobs j on j.job_number = a.job_number
     where a.status in ('approved','meeting','interview','contracted','working')
       and a.terms_snapshot is not null
       and j.status in ('open','closed')
       and j.work_time ~ '^\d{1,2}:\d{2}'
       and a.work_completed_at is null
       and coalesce(a.attended, true)
       and v_today in (select public.app_work_dates(a.id))
  loop
    v_start_min := split_part(split_part(r.work_time,'〜',1),':',1)::int * 60
                 + split_part(split_part(r.work_time,'〜',1),':',2)::int;
    v_end_min := null;
    if split_part(r.work_time,'〜',2) ~ '^\d{1,2}:\d{2}' then
      v_end_min := split_part(split_part(r.work_time,'〜',2),':',1)::int * 60
                 + split_part(split_part(r.work_time,'〜',2),':',2)::int;
    end if;

    foreach v_kind in array array['before_60','before_15','start','end'] loop
      v_target := case v_kind
        when 'before_60' then v_start_min - 60
        when 'before_15' then v_start_min - 15
        when 'start'     then v_start_min
        when 'end'       then v_end_min
      end;
      if v_target is null or v_target < 0 then continue; end if;
      if v_kind = 'end' and v_end_min <= v_start_min then continue; end if;
      if v_now_min < v_target or v_now_min >= v_target + 10 then continue; end if;

      foreach v_role in array array['worker','farmer'] loop
        v_ok := case
          when v_kind in ('before_60','before_15') then
            r.started_at is null or (r.started_at at time zone 'Asia/Tokyo')::date <> v_today
          when v_kind = 'end' and v_role = 'worker' then
            not exists (select 1 from public.reviews rv
                         where rv.application_id = r.app_id and rv.reviewer_id = r.worker_id)
          else true
        end;
        if not v_ok then continue; end if;

        v_to := case when v_role = 'worker' then r.worker_id else r.farmer_id end;
        if public.is_account_moderated(v_to) then continue; end if;

        insert into public.job_time_notices (application_id, kind, role, work_date)
        values (r.app_id, v_kind, v_role, v_today)
        on conflict do nothing;
        get diagnostics v_ins = row_count;
        if v_ins = 0 then continue; end if;

        v_mail := public.job_time_notice_mail(r.app_id, v_kind, v_role);
        if v_mail is not null then
          begin
            v_req := public.send_user_email(v_to, v_mail->>'subject', v_mail->>'body', v_mail->>'html');
          exception when others then v_req := null; end;
          update public.job_time_notices
             set request_id = v_req
           where application_id = r.app_id and kind = v_kind and role = v_role
             and work_date = v_today;
        end if;
      end loop;
    end loop;
  end loop;
end $function$;
