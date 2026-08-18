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

-- ── 運営の見守り：打刻の署名時刻を見ない ──────────────────
create or replace function public.admin_attention()
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_fix json; v_stall json;
begin
  if v_uid is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  if not exists (select 1 from public.app_admins a where a.auth_id = v_uid) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;

  select json_build_object(
    'errors', coalesce((
      select json_agg(x order by x.latest desc) from (
        select coalesce(nullif(btrim(e.component), ''), '(不明)') as component,
               left(coalesce(nullif(btrim(e.message), ''), '(メッセージなし)'), 160) as message,
               count(*)::int as cnt,
               max(e.created_at) as latest,
               (array_agg(e.page order by e.created_at desc))[1] as page
          from public.app_errors e
         where e.status = 'open'
         group by 1, 2
         order by max(e.created_at) desc
         limit 8
      ) x), '[]'::json),
    'error_total', (select count(*)::int from public.app_errors where status = 'open'),
    'reports_message', (select count(*)::int from public.message_reports where status = 'open'),
    'reports_job',     (select count(*)::int from public.job_reports     where status = 'open'),
    'reports_profile', (select count(*)::int from public.profile_reports where status = 'open'),
    'withdrawals',     (select count(*)::int from public.withdrawal_requests where processed_at is null),
    'feedback_7d',     (select count(*)::int from public.feedback where created_at >= now() - interval '7 days')
  ) into v_fix;

  with applied as (
    select count(*)::int n, max(v_today - created_at::date) d from public.applications where status = 'applied'
  ), pend as (
    select count(*)::int n, max(v_today - created_at::date) d from public.jobs where status = 'pending'
  ), rev as (
    select count(*)::int n, max(v_today - revision_requested_at::date) d
      from public.jobs where status = 'draft' and revision_requested_at is not null
  ), q as (
    select count(*)::int n, max(v_today - created_at::date) d
      from public.job_questions where coalesce(answer, '') = '' and hidden = false
  ), comp as (
    select count(*)::int n from public.applications a join public.jobs j on j.job_number = a.job_number
     where a.status in ('approved','meeting','interview','contracted','working')
       and a.work_completed_at is null
       and coalesce(j.date_end, j.date_start) < v_today
  ), emg as (
    select count(*)::int n from public.attendance_events where created_at >= now() - interval '7 days'
  )
  select json_build_object(
    'applied',      json_build_object('n', applied.n, 'days', applied.d),
    'pending_jobs', json_build_object('n', pend.n,    'days', pend.d),
    'revision',     json_build_object('n', rev.n,     'days', rev.d),
    'questions',    json_build_object('n', q.n,       'days', q.d),
    'complete_missing',  json_build_object('n', comp.n, 'days', null),
    'emergency_7d',      json_build_object('n', emg.n,  'days', null)
  ) into v_stall
  from applied, pend, rev, q, comp, emg;

  return json_build_object('ok', true, 'fix', v_fix, 'stall', v_stall);
end;
$function$;

-- ── 仕事中ページ：開始確認（農家）・終了確認（働き手）の欄を落とす ────
-- started_at は残す＝自動開始が入れた「開始（自動）」の時刻として運営が見る
create or replace function public.admin_working_jobs()
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_working json;
  v_upcoming json;
  v_expired json;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;

  select coalesce(json_agg(row order by started_at_raw asc nulls last), '[]'::json) into v_working
  from (
    select
      json_build_object(
        'application_id', a.id,
        'job_number', a.job_number,
        'worker_id', a.worker_id,
        'farmer_id', a.farmer_id,
        'worker_name', wp.nickname,
        'farmer_name', ep.nickname,
        'crop', j.crop,
        'task', j.task,
        'prefecture', j.prefecture,
        'city', j.city,
        'date_label', j.date_label,
        'date_start', j.date_start,
        'date_end', j.date_end,
        'agreed_dates', a.agreed_dates,
        'auto_started', a.auto_started,
        'attended', a.attended,
        'started_at', to_char(a.started_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'work_completed_at', to_char(a.work_completed_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'insurance_prepared_at', to_char(a.insurance_prepared_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI')
      ) as row,
      a.started_at as started_at_raw
    from public.applications a
    left join public.jobs j on j.job_number = a.job_number
    left join public.worker_profiles wp on wp.auth_id = a.worker_id
    left join public.employer_profiles ep on ep.auth_id = a.farmer_id
    where a.status = 'working'
  ) t;

  select coalesce(json_agg(row order by ord_date asc nulls last), '[]'::json) into v_upcoming
  from (
    select
      json_build_object(
        'application_id', a.id,
        'job_number', a.job_number,
        'worker_id', a.worker_id,
        'farmer_id', a.farmer_id,
        'worker_name', wp.nickname,
        'farmer_name', ep.nickname,
        'crop', j.crop,
        'task', j.task,
        'prefecture', j.prefecture,
        'city', j.city,
        'date_label', j.date_label,
        'date_start', j.date_start,
        'date_end', j.date_end,
        'agreed_dates', a.agreed_dates,
        'insurance_prepared_at', to_char(a.insurance_prepared_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'hired_at', to_char(greatest(a.terms_confirmed_worker_at, a.terms_confirmed_farmer_at) at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI')
      ) as row,
      j.date_start as ord_date
    from public.applications a
    left join public.jobs j on j.job_number = a.job_number
    left join public.worker_profiles wp on wp.auth_id = a.worker_id
    left join public.employer_profiles ep on ep.auth_id = a.farmer_id
    where a.status = 'approved'
      and a.terms_confirmed_worker_at is not null
      and a.terms_confirmed_farmer_at is not null
      and a.started_at is null
  ) t;

  -- 失効の見張り（2026-08-06）：直近14日に失効した応募。
  -- 「判断がないまま作業開始を迎えた」＝実際に働いていた可能性が残る（#1054型）。
  -- was_approved＝失効の瞬間のevent_audit（柱1・行動記録）でold=approvedだったもの
  select coalesce(json_agg(row order by ord_ts desc nulls last), '[]'::json) into v_expired
  from (
    select
      json_build_object(
        'application_id', a.id,
        'job_number', a.job_number,
        'worker_id', a.worker_id,
        'farmer_id', a.farmer_id,
        'worker_name', wp.nickname,
        'farmer_name', ep.nickname,
        'crop', j.crop,
        'task', j.task,
        'prefecture', j.prefecture,
        'city', j.city,
        'date_label', j.date_label,
        'date_start', j.date_start,
        'date_end', j.date_end,
        'agreed_dates', a.agreed_dates,
        'available_dates', a.available_dates,
        'was_approved', exists (
          select 1 from public.event_audit ev
           where ev.table_name = 'applications' and ev.row_pk = a.id::text
             and ev.diff->'status'->>'new' = 'expired'
             and ev.diff->'status'->>'old' = 'approved'),
        'applied_at', to_char(a.created_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'expired_at', to_char(a.decided_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI')
      ) as row,
      a.decided_at as ord_ts
    from public.applications a
    left join public.jobs j on j.job_number = a.job_number
    left join public.worker_profiles wp on wp.auth_id = a.worker_id
    left join public.employer_profiles ep on ep.auth_id = a.farmer_id
    where a.status = 'expired'
      and a.decided_at >= now() - interval '14 days'
  ) t;

  return json_build_object('ok', true, 'working', v_working, 'upcoming', v_upcoming, 'expired_watch', v_expired);
end; $function$;
