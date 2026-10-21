-- いつでもOK応募は全期間働く前提（2026-07-24たきと確定）：agreed_dates='"any"' は日程確定ずみ扱い。
-- 農家の「働く日を決める」(decide_dates) は、日程情報が何も無い（agreed_dates is null＝旧データ等）の時だけ出す。
-- 当日判定は従来どおり："any" は期間判定にフォールバック＝全期間が当日対象（my_nav_badges・フロントも同挙動）。
-- 変更点は fstage の decide_dates 条件のみ（(agreed_dates is null or ='"any"') → agreed_dates is null）。他は 20260724110000 と同一。
create or replace function public.my_todo_items()
 returns table(my_role text, stage text, job_number integer, application_id uuid,
   crop text, task text, partner_name text, date_start date, date_end date,
   work_time text, agreed_dates jsonb, sort_key date)
 language sql
 security definer
 set search_path to 'public'
as $function$
  with u as (select auth.uid() as uid, (now() at time zone 'Asia/Tokyo')::date as today),
  rev as (
    select 'farmer'::text my_role, 'revision'::text stage, j.job_number, null::uuid application_id,
           j.crop, j.task, null::text partner_name, j.date_start, j.date_end, j.work_time, null::jsonb agreed_dates,
           u.today sort_key
    from jobs j, u
    where j.farmer_id = u.uid and j.status = 'draft' and j.revision_requested_at is not null
  ),
  fa as (
    select a.id, a.status, a.job_number, a.agreed_dates, a.started_at, a.farmer_confirmed_start_at,
           a.insurance_prepared_at, a.work_completed_at,
           j.crop, j.task, j.date_start, j.date_end, j.work_time,
           public.resolve_actor_name(a.worker_id) partner_name,
           (j.date_end is not null and j.date_end <> j.date_start) is_period,
           exists(select 1 from messages m where m.application_id = a.id and m.sender_id <> u.uid and m.read_at is null) unread,
           u.uid, u.today
    from applications a join jobs j on j.job_number = a.job_number, u
    where a.farmer_id = u.uid
  ),
  fstage as (
    select 'farmer'::text my_role,
      case
        when status = 'applied' then 'approve'
        when status in ('approved','meeting','interview','contracted','working') and started_at is not null and farmer_confirmed_start_at is null then 'confirm_start'
        when status in ('approved','meeting','interview','contracted','working') and farmer_confirmed_start_at is not null and status <> 'completed' then 'complete'
        when status in ('approved','meeting','interview','contracted','working') and is_period and agreed_dates is null then 'decide_dates'
        when status in ('approved','meeting','interview','contracted','working') and insurance_prepared_at is null then 'insurance'
        when status = 'completed' and work_completed_at is not null and work_completed_at >= now() - interval '3 days'
             and not exists(select 1 from reviews r where r.application_id = id and r.reviewer_id = uid) then 'review'
        when unread then 'chat'
        else null
      end stage,
      job_number, id application_id, crop, task, partner_name, date_start, date_end, work_time, agreed_dates,
      case when started_at is not null or farmer_confirmed_start_at is not null then today
           else coalesce(date_start, today) end sort_key
    from fa
  ),
  wa as (
    select a.id, a.status, a.job_number, a.agreed_dates, a.started_at, a.worker_confirmed_end_at,
           a.terms_confirmed_worker_at, a.attended, a.work_completed_at,
           j.crop, j.task, j.date_start, j.date_end, j.work_time,
           public.resolve_actor_name(a.farmer_id) partner_name,
           exists(select 1 from messages m where m.application_id = a.id and m.sender_id <> u.uid and m.read_at is null) unread,
           ((u.today between j.date_start and coalesce(j.date_end, j.date_start))
            or (a.agreed_dates is not null and jsonb_typeof(a.agreed_dates) = 'array'
                and exists(select 1 from jsonb_array_elements_text(a.agreed_dates) d where d::date = u.today))) is_work_day,
           u.uid, u.today
    from applications a join jobs j on j.job_number = a.job_number, u
    where a.worker_id = u.uid
  ),
  wstage as (
    select 'worker'::text my_role,
      case
        when status = 'applied' then 'w_waiting'
        when status in ('approved','meeting','interview','contracted','working') and terms_confirmed_worker_at is null then 'w_confirm'
        when status in ('approved','meeting','interview','contracted','working') and is_work_day and started_at is null then 'w_start'
        when status = 'completed' and attended is distinct from false and worker_confirmed_end_at is null
             and work_completed_at is not null and work_completed_at >= now() - interval '3 days' then 'w_review'
        when unread then 'chat'
        else null
      end stage,
      job_number, id application_id, crop, task, partner_name, date_start, date_end, work_time, agreed_dates,
      case when is_work_day then today else coalesce(date_start, today) end sort_key
    from wa
  )
  select my_role, stage, job_number, application_id, crop, task, partner_name, date_start, date_end, work_time, agreed_dates, sort_key from rev
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, date_start, date_end, work_time, agreed_dates, sort_key from fstage where stage is not null
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, date_start, date_end, work_time, agreed_dates, sort_key from wstage where stage is not null
$function$;
grant execute on function public.my_todo_items() to authenticated;
