-- 求人の日程の「移動」（2026-08-19たきと指示＝TimeTree式のコピー・移動・編集をカレンダーに）。
-- コピー＝既存 copy_job／編集＝既存の一時非公開→編集レールso、新設はこの「移動」だけ。
-- 期間・休日を同じ日数だけ丸ごとずらす（TimeTreeの予定ドラッグに相当）。
--
-- 【壁（この順で検査）】
--  ・本人の求人だけ（farmer_id = auth.uid()）／停止中アカウントは不可
--  ・draft/pending/open のみ（closed＝過去の記録は動かさない・2026-08-05「過去の求人は消すな」と同じ思想)
--  ・進行中の応募（applied〜working）が1件でもあれば拒否＝働き手は日程を見て応募している。
--    その後の日程調整は既存レール（チャット相談＋働く日を決める＋当日は緊急連絡の延期）
--  ・新しい開始日は今日（JST・2026-08-07の日付規約）以降
-- 【動かすもの】date_start・date_end・holidays（各日+delta）・date_label（再生成＝表示の正は
--  date_start/end から再計算されるが、date_label 直読みの画面（見守り・通知書等）を古い文字列にしない）
-- 【動かさないもの】掲載時スナップショット（募集主・待遇・保険・支払）・opened_at・status。
--  status不変so、公開系トリガー（block_third_party_open・notify_*・clear_revision等）は発火しない。
--  記録は jobs の firehose トリガーthat event_audit に自動で残す（行動記録の憲法）。
create or replace function public.move_job_dates(p_job_number integer, p_new_start date)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid; v_job public.jobs%rowtype; v_delta integer; v_today date;
  v_new_end date; v_new_holidays jsonb; v_label text; v_inyear boolean;
  v_wd text[] := array['日','月','火','水','木','金','土'];
begin
  v_uid := auth.uid();
  if v_uid is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  if public.is_account_moderated(v_uid) then
    return json_build_object('ok', false, 'reason', 'account_suspended');
  end if;
  if p_new_start is null then return json_build_object('ok', false, 'reason', 'no_date'); end if;

  select * into v_job from public.jobs where job_number = p_job_number;
  if v_job.job_number is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_job.farmer_id <> v_uid then return json_build_object('ok', false, 'reason', 'not_yours'); end if;
  if v_job.status not in ('draft','pending','open') then
    return json_build_object('ok', false, 'reason', 'bad_status');
  end if;
  if v_job.date_start is null then return json_build_object('ok', false, 'reason', 'no_dates'); end if;

  v_today := (now() at time zone 'Asia/Tokyo')::date;
  if p_new_start < v_today then return json_build_object('ok', false, 'reason', 'past_date'); end if;

  if exists (select 1 from public.applications a
              where a.job_number = p_job_number
                and a.status in ('applied','approved','meeting','interview','contracted','working')) then
    return json_build_object('ok', false, 'reason', 'has_applications');
  end if;

  v_delta := p_new_start - v_job.date_start;
  if v_delta = 0 then return json_build_object('ok', true, 'unchanged', true); end if;
  v_new_end := v_job.date_end + v_delta;  -- date_end that null なら null のまま（単日求人）

  -- 休日も同じ日数ずらす（配列でなければそのまま）
  if v_job.holidays is not null and jsonb_typeof(v_job.holidays) = 'array'
     and jsonb_array_length(v_job.holidays) > 0 then
    select jsonb_agg(to_jsonb(to_char((h)::date + v_delta, 'YYYY-MM-DD')) order by h)
      into v_new_holidays
      from jsonb_array_elements_text(v_job.holidays) h;
  else
    v_new_holidays := v_job.holidays;
  end if;

  -- date_label 再生成＝フロント jobDateLabel と同じ規則（今年なら年を省く・単日はその日だけ・
  -- 同月の期間は終わり側を日だけに）。フロントの形式を変えたらここも合わせること
  v_inyear := extract(year from p_new_start) = extract(year from v_today)
          and extract(year from coalesce(v_new_end, p_new_start)) = extract(year from v_today);
  if v_new_end is null or v_new_end = p_new_start then
    v_label := case when v_inyear then to_char(p_new_start, 'FMMM/FMDD')
                    else to_char(p_new_start, 'YYYY/FMMM/FMDD') end
               || '（' || v_wd[extract(dow from p_new_start)::int + 1] || '）';
  else
    v_label := case when v_inyear then to_char(p_new_start, 'FMMM/FMDD')
                    else to_char(p_new_start, 'YYYY/FMMM/FMDD') end
               || '（' || v_wd[extract(dow from p_new_start)::int + 1] || '） 〜 ';
    if v_inyear and extract(year from p_new_start) = extract(year from v_new_end)
       and extract(month from p_new_start) = extract(month from v_new_end) then
      v_label := v_label || to_char(v_new_end, 'FMDD')
                 || '（' || v_wd[extract(dow from v_new_end)::int + 1] || '）';
    else
      v_label := v_label || case when v_inyear then to_char(v_new_end, 'FMMM/FMDD')
                                 else to_char(v_new_end, 'YYYY/FMMM/FMDD') end
                 || '（' || v_wd[extract(dow from v_new_end)::int + 1] || '）';
    end if;
  end if;

  update public.jobs
     set date_start = p_new_start,
         date_end   = v_new_end,
         holidays   = v_new_holidays,
         date_label = v_label
   where job_number = p_job_number;

  return json_build_object('ok', true, 'date_start', p_new_start, 'date_end', v_new_end,
                           'delta_days', v_delta, 'date_label', v_label);
end;
$function$;

-- ログイン後専用（作成時のPUBLIC自動EXECUTEを落とす＝from public と from anon の両方・2026-08-06の教訓）
revoke all on function public.move_job_dates(integer, date) from public;
revoke all on function public.move_job_dates(integer, date) from anon;
grant execute on function public.move_job_dates(integer, date) to authenticated;
