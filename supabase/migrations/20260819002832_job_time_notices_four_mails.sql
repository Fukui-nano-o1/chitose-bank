-- 当日の時刻メールを4種に整理（2026-08-19たきと指示）
--   「作業開始1時間前と開始時間に一通ずつ。今日の作業終了通知を一通。全ての日程終了に一通。合計四通に変更。」
--
-- ■ 変更点
--   ・before_15（15分前）を廃止。1時間前(before_60)と開始時刻(start)の間に3通目は置かない。
--   ・end を「本日の作業終了」に位置づけ直す＝働く日ごとの締め（報酬の当日受け渡しの合図）。
--   ・all_done「全日程が終了しました」を新設＝最終作業日の終了時刻。完了の記録と評価はここで頼む。
--
-- ■ 最終日は end を出さず all_done に譲る（同じ分に2通出さないため）。
--   したがって1日の求人は before_60 / start / all_done の3通、複数日は
--   （before_60 / start / end）×中日 ＋ 最終日は（before_60 / start / all_done）。
--   最終日にも「本日の作業終了」を出したい場合は、下の「最終日は譲る」の1行を外すだけでよい。
--
-- ■ 最終作業日 ＝ app_work_dates(応募) の最大日（働く日の唯一のソース。カレンダー・二重予約の壁と同じ）。
--
-- ■ 自動完了（auto_complete_work・毎時20分）との噛み合わせ
--   自動完了は最終日の終了時刻を過ぎると status='completed' にする。時刻メールの取り出し条件から
--   「work_completed_at is null」を外し、種類ごとに条件を持たせた＝最終日の all_done が
--   自動完了に食われて出ないことがない。中日の end / start / before_60 は
--   「まだ完了していない」ことを種類側で確かめる（＝時刻になったから無条件送信、は禁止のまま）。
--
-- ■ 記録：job_time_notices（応募×種類×役割×作業日）で1回だけ。before_15 の過去の行は消さない
--   ので CHECK は 'before_15' を残したまま 'all_done' を足す。

alter table public.job_time_notices drop constraint if exists job_time_notices_kind_check;
alter table public.job_time_notices add constraint job_time_notices_kind_check
  check (kind = any (array['before_60'::text,'before_15'::text,'start'::text,'end'::text,'all_done'::text]));

create or replace function public.job_time_notice_mail(p_app uuid, p_kind text, p_role text)
returns jsonb
language plpgsql
stable
security definer
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
    v_subject := '本日の作業終了の時間です';
    v_body := '本日の作業終了時刻になりました。' || E'\n\n' ||
              '作業お疲れさまでした。' || E'\n' ||
              '報酬は当日その場で現金でお受け取りください。' || E'\n\n' ||
              '次の作業日は「今日の仕事」からご確認いただけます。';
    v_btn_label := '今日の仕事を見る'; v_btn_url := 'https://chitose-bank.com/#/calendar';
    v_sub := '急ぎの連絡はこちら';

  elsif p_kind = 'end' and p_role = 'farmer' then
    v_subject := '本日の作業終了の時間です';
    v_body := '本日の作業終了時刻になりました。' || E'\n\n' ||
              '報酬は当日その場で現金でお渡しください。' || E'\n\n' ||
              '完了の記録と評価は、全ての日程が終わったあとにお願いします。';
    v_btn_label := '今日の仕事を見る'; v_btn_url := 'https://chitose-bank.com/#/calendar';
    v_sub := '急ぎの連絡はこちら';

  elsif p_kind = 'all_done' and p_role = 'worker' then
    v_subject := '全日程が終了しました｜評価をお願いします';
    v_body := 'この求人の全ての日程が終了しました。' || E'\n\n' ||
              '作業お疲れさまでした。' || E'\n' ||
              '報酬は当日その場で現金でお受け取りください。' || E'\n\n' ||
              '最後に農家への評価をお願いします。';
    v_btn_label := '農家を評価する'; v_btn_url := 'https://chitose-bank.com/#/calendar/todo/w_review';

  elsif p_kind = 'all_done' and p_role = 'farmer' then
    v_subject := '全日程が終了しました｜完了を確認してください';
    v_body := 'この求人の全ての日程が終了しました。' || E'\n\n' ||
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

revoke all on function public.job_time_notice_mail(uuid, text, text) from public, anon, authenticated;

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
           a.started_at, a.work_completed_at, a.auto_completed, a.status,
           (select max(d) from public.app_work_dates(a.id) d) as last_day
      from public.applications a
      join public.jobs j on j.job_number = a.job_number
     where a.status in ('approved','meeting','interview','contracted','working','completed')
       and a.terms_snapshot is not null
       and j.status in ('open','closed')
       and j.work_time ~ '^\d{1,2}:\d{2}'
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

    foreach v_kind in array array['before_60','start','end','all_done'] loop
      v_target := case v_kind
        when 'before_60' then v_start_min - 60
        when 'start'     then v_start_min
        else v_end_min
      end;
      if v_target is null or v_target < 0 then continue; end if;
      if v_kind in ('end','all_done') and (v_end_min is null or v_end_min <= v_start_min) then continue; end if;
      -- 最終日は「本日の作業終了」を出さず「全日程が終了しました」に譲る（同じ分に2通出さない）
      if v_kind = 'end'      and v_today =  r.last_day then continue; end if;
      if v_kind = 'all_done' and v_today <> r.last_day then continue; end if;
      if v_now_min < v_target or v_now_min >= v_target + 10 then continue; end if;

      foreach v_role in array array['worker','farmer'] loop
        v_ok := case
          when v_kind = 'before_60' then
            r.status <> 'completed'
            and (r.started_at is null or (r.started_at at time zone 'Asia/Tokyo')::date <> v_today)
          when v_kind in ('start','end') then
            r.status <> 'completed'
          when v_kind = 'all_done' and v_role = 'worker' then
            not exists (select 1 from public.reviews rv
                         where rv.application_id = r.app_id and rv.reviewer_id = r.worker_id)
          when v_kind = 'all_done' and v_role = 'farmer' then
            r.work_completed_at is null or coalesce(r.auto_completed, false)
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

revoke all on function public.send_job_time_notices() from public, anon, authenticated;

-- 件名が変わった／増えたので照合パターンも直す（直さないとメール番号が付かなくなる）
update public.mail_registry
   set label = '（廃止）まもなく開始（15分前）'
 where code = 'M31';
update public.mail_registry
   set subject_pattern = '本日の作業終了の時間です',
       label = '本日の作業終了（働く日ごと）'
 where code = 'M33';
insert into public.mail_registry (code, subject_pattern, priority, label) values
  ('M42', '全日程が終了しました', 100, '全日程終了のお知らせ')
on conflict (code) do update
  set subject_pattern = excluded.subject_pattern, label = excluded.label;
