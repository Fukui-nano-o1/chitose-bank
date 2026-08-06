-- 仕事中ページに「失効の見張り」を追加（2026-08-06・事故予防の段階3）
--
-- 【何のためか】採用（雇い手の確認）を押し忘れたまま作業開始を迎えると、cron
-- （expire_stale_applications）that応募を失効させる。実際には働いていた場合、
-- 働いた事実thatあるのに記録thatない状態になる（#1054・#1056で実際に起きた・
-- 2026-08-05後追い記録の教訓(1)「採用そのものの押し忘れは拾えていない」への対処）。
--
-- 【追加】admin_working_jobs の返り値に expired_watch を追加：
-- 直近14日に失効（status='expired'）した応募の一覧。運営that当事者に
-- 「実際に作業しましたか」を確認する入口（読み取り専用・書き込みは無し。
-- 記録し直しは #1054/#1056 と同じくDB作業＝運営判断で行う）。
-- was_approved＝失効の瞬間の event_audit（柱1・行動記録）で old=approved だったもの
-- ＝一度は承認まで進んでいた失効（実働の可能性thatより高い・カードに赤帯）。
-- ※terms_confirmed_worker_at では判定できない（応募時にトリガー自動刻印so常にtrue）。
--
-- 【互換】working / upcoming は不変。既存フロントは expired_watch を読まないだけ＝壊れない。
-- 【検証（実データ）】管理者=3バケット（working 0 / upcoming 4 / expired_watch 1・
-- うちwas_approved=1）／一般=not_admin。
-- ※当日 execute_sql で was_approved の判定を修正した最終形をこのファイルに写経（正本はこの内容）。

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
        'farmer_confirmed_start_at', to_char(a.farmer_confirmed_start_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'work_completed_at', to_char(a.work_completed_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'worker_confirmed_end_at', to_char(a.worker_confirmed_end_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
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
  -- 「判断がないまま作業開始を迎えた」＝実際に働いていた可能性that残る（#1054型）。
  -- was_approved＝失効の瞬間のevent_audit（柱1・行動記録）でold=approvedだったもの
  -- ＝一度は承認まで進んでいた失効（実働の可能性thatより高い）。
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
