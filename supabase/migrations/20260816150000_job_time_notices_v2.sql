-- 作業当日の時刻メール v2（2026-08-16たきと指示：役割ごとに書き分け・ボタン・発火条件）
--
-- 【v1からの変更】
-- 1. 文面をたきと指定のものに差し替え。60分前＝「準備」、15分前＝「異常があるなら今すぐ連絡」と
--    役割を分ける（同じ文を時間だけ変えて2回送らない）。
-- 2. 開始時刻は働き手と農家で内容を分ける。働き手に「開始ボタンを押してください」とは言わない
--    （開始ボタンは2026-07-27に廃止・auto_start_work が自動記録する）。農家にだけ「開始を確認」を促す。
-- 3. ボタン（HTMLメール）を追加。行き先は現行の実在ルート：
--      緊急連絡      #/emergency/{application_id}
--      今日の仕事    #/calendar
--      開始を確認    #/calendar/todo/confirm_start
--      終了を確認    #/calendar/todo/w_review
--      完了して評価  #/calendar/todo/complete
-- 4. ★発火条件を役割ごとに持つ（「時刻になったから無条件送信」をやめる）。
--    そのため送信の記録に role を足した（同じ時刻でも、片方には送り片方には送らない場合があるため）。
--
-- 【発火条件】
--   共通：契約あり（terms_snapshot）／status が approved〜working／今日が実働日／
--         完了が記録されていない（work_completed_at is null）／欠勤が記録されていない（attended が false でない）／
--         受け取る本人が停止・追放中でない
--   60分前・15分前：開始がまだ記録されていない（started_at is null）＝もう始まっているなら送らない
--   開始・農家：開始の確認がまだ（farmer_confirmed_start_at is null）＝確認済みに「確認してください」と言わない
--   終了・働き手：終了の確認がまだ（worker_confirmed_end_at is null）
--   終了・農家：完了がまだ（共通条件と同じ）
--   日またぎ（終了 <= 開始）は終了メールを送らない（v1から不変）
--
-- 【送らないもの】終了時刻より後の繰り返し督促は作らない。作業後の督促は既存の
--   M12「作業は終わりましたか」（翌朝9時・最大2回）と M13（働き手への評価依頼）が担う。
--   ここに重ねると通知が騒音になる（2026-08-16たきと指摘）。

-- ── 送信の記録：役割ごとに持つ（v1は空なので作り直す） ──────────────────────────
drop table if exists public.job_time_notices;
create table public.job_time_notices (
  application_id uuid not null references public.applications(id) on delete cascade,
  work_date      date not null,
  kind           text not null check (kind in ('before_60','before_15','start','end')),
  role           text not null check (role in ('worker','farmer')),
  sent_at        timestamptz not null default now(),
  primary key (application_id, work_date, kind, role)
);
alter table public.job_time_notices enable row level security;
revoke all on table public.job_time_notices from anon, authenticated;

-- ── 文面の唯一のソース（送信とプレビューで共用） ─────────────────────────────
create or replace function public.job_time_notice_mail(p_app uuid, p_kind text, p_role text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
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
    v_subject := '仕事開始の時間です｜開始を確認してください';
    v_body := '予定の仕事開始時刻になりました。' || E'\n' ||
              '働き手が到着し、実際に作業を始めたことをご確認ください。' || E'\n\n' ||
              '作業が始まったら「開始を確認」を押してください。' || E'\n' ||
              '働き手が来ていない場合は「来なかった」から記録できます。';
    v_btn_label := '開始を確認する'; v_btn_url := 'https://chitose-bank.com/#/calendar/todo/confirm_start';

  elsif p_kind = 'end' and p_role = 'worker' then
    v_subject := '仕事終了の時間です｜終了を確認してください';
    v_body := '予定の仕事終了時刻になりました。' || E'\n\n' ||
              '作業が終了したら、勤務内容をご確認ください。' || E'\n' ||
              '報酬は当日その場で現金でお受け取りください。' || E'\n\n' ||
              '最後に仕事の終了確認と農家への評価をお願いします。';
    v_btn_label := '終了を確認して評価する'; v_btn_url := 'https://chitose-bank.com/#/calendar/todo/w_review';

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
end $$;

revoke all on function public.job_time_notice_mail(uuid, text, text) from public, anon, authenticated;

-- ── 送信本体（cron・5分ごと） ───────────────────────────────────────────
create or replace function public.send_job_time_notices()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_today date; v_now_min int;
  v_start_min int; v_end_min int;
  v_kind text; v_role text; v_target int; v_ins int; v_ok boolean;
  v_to uuid; v_mail jsonb;
begin
  v_today   := (now() at time zone 'Asia/Tokyo')::date;
  v_now_min := (extract(hour   from now() at time zone 'Asia/Tokyo')::int) * 60
             + (extract(minute from now() at time zone 'Asia/Tokyo')::int);

  for r in
    select a.id as app_id, a.worker_id, a.farmer_id, j.work_time,
           a.started_at, a.farmer_confirmed_start_at, a.worker_confirmed_end_at,
           a.work_completed_at, a.attended
      from public.applications a
      join public.jobs j on j.job_number = a.job_number
     where a.status in ('approved','meeting','interview','contracted','working')
       and a.terms_snapshot is not null
       and j.status in ('open','closed')
       and j.work_time ~ '^\d{1,2}:\d{2}'
       and a.work_completed_at is null            -- 完了が記録されたら以降は送らない
       and coalesce(a.attended, true)             -- 欠勤が記録されたら送らない
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
        -- 役割ごとの発火条件（時刻が来たというだけでは送らない）
        v_ok := case
          when v_kind in ('before_60','before_15') then r.started_at is null
          when v_kind = 'start'  and v_role = 'farmer' then r.farmer_confirmed_start_at is null
          when v_kind = 'end'    and v_role = 'worker' then r.worker_confirmed_end_at is null
          else true
        end;
        if not v_ok then continue; end if;

        v_to := case when v_role = 'worker' then r.worker_id else r.farmer_id end;
        if public.is_account_moderated(v_to) then continue; end if;

        insert into public.job_time_notices (application_id, work_date, kind, role)
        values (r.app_id, v_today, v_kind, v_role)
        on conflict do nothing;
        get diagnostics v_ins = row_count;
        if v_ins = 0 then continue; end if;      -- 送信済み

        v_mail := public.job_time_notice_mail(r.app_id, v_kind, v_role);
        if v_mail is not null then
          begin
            perform public.send_user_email(v_to, v_mail->>'subject', v_mail->>'body', v_mail->>'html');
          exception when others then null; end;
        end if;
      end loop;
    end loop;
  end loop;
end $$;

revoke all on function public.send_job_time_notices() from public, anon, authenticated;

-- ── 確認用（HTMLも本番と同じもので送る） ────────────────────────────────
create or replace function public.admin_preview_job_time_notices(p_to uuid, p_app uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_app uuid; v_kind text; v_role text; v_mail jsonb; v_n int := 0;
begin
  if auth.uid() is not null
     and not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  v_app := p_app;
  if v_app is null then
    select a.id into v_app
      from public.applications a join public.jobs j on j.job_number = a.job_number
     where a.terms_snapshot is not null and j.work_time ~ '^\d{1,2}:\d{2}'
     order by a.created_at desc limit 1;
  end if;
  if v_app is null then return jsonb_build_object('ok', false, 'reason', 'no_sample'); end if;

  foreach v_kind in array array['before_60','before_15','start','end'] loop
    foreach v_role in array array['worker','farmer'] loop
      v_mail := public.job_time_notice_mail(v_app, v_kind, v_role);
      if v_mail is not null then
        perform public.send_user_email(p_to, v_mail->>'subject',
          '※これは確認用の送信です（実際の予定ではありません）。' || E'\n' ||
          '※宛先の別：' || case when v_role='worker' then '働き手に届く文面' else '農家に届く文面' end || E'\n' ||
          '――――――――――' || E'\n\n' || (v_mail->>'body'),
          '<p style="font-family:sans-serif;font-size:12px;color:#B0B0B0;max-width:560px;margin:0 auto 12px;">'
          || '※これは確認用の送信です（実際の予定ではありません）／'
          || case when v_role='worker' then '働き手に届く文面' else '農家に届く文面' end || '</p>'
          || (v_mail->>'html'));
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'sent', v_n, 'application_id', v_app);
end $$;

revoke all on function public.admin_preview_job_time_notices(uuid, uuid) from public, anon, authenticated;

-- ── メール番号：件名が変わったのでパターンを差し替え ────────────────────────
-- 働き手「仕事開始まであと1時間です」／農家「作業開始まであと1時間です」の共通部分で拾う
update public.mail_registry set subject_pattern = '開始まであと1時間です',
       label = 'まもなく作業開始（1時間前）' where code = 'M10';
update public.mail_registry set subject_pattern = '開始まであと15分です',
       label = 'まもなく開始（15分前）'     where code = 'M31';
update public.mail_registry set subject_pattern = '仕事開始の時間です',
       label = '仕事開始の時間です'         where code = 'M32';
update public.mail_registry set subject_pattern = '仕事終了の時間です',
       label = '仕事終了の時間です'         where code = 'M33';
