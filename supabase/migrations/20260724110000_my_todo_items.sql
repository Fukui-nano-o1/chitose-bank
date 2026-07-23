-- 今日ページ＝取引の採配台（2026-07-24）：「やること」フィードの単一ソース my_todo_items()。
-- 農家・働き手の「対応が必要な1件」を、状態(stage)＋締切ソート鍵つきで返す。新規列なし＝既存列の状態判定のみ。
-- my_nav_badges.todo = count(*) from my_todo_items() ＝ バッジ数字とやることカード枚数が必ず一致（同一ソース）。
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
        when status in ('approved','meeting','interview','contracted','working') and is_period and (agreed_dates is null or agreed_dates = '"any"'::jsonb) then 'decide_dates'
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

-- my_nav_badges に todo（やること総数＝count(*) from my_todo_items()）を追加。今日タブのバッジはこの数字を使う（フロント）。
create or replace function public.my_nav_badges()
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select json_build_object(
    'chat_threads', (
      select count(distinct m.application_id)
        from public.messages m join public.applications a on a.id = m.application_id
       where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
         and a.status in ('applied','approved','meeting','interview','contracted','working','completed','rejected')
         and m.sender_id <> auth.uid() and m.read_at is null
    ) + (case when exists (
        select 1 from public.admin_messages am
        where am.user_id = auth.uid() and am.from_admin and am.read_at is null
      ) then 1 else 0 end),
    'calendar_today', (
      select count(*) from public.applications a join public.jobs j on j.job_number = a.job_number
      where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
        and a.terms_snapshot is not null
        and j.date_start is not null
        and case
          when a.agreed_dates is not null and jsonb_typeof(a.agreed_dates) = 'array' and jsonb_array_length(a.agreed_dates) > 0
            then exists (select 1 from jsonb_array_elements_text(a.agreed_dates) d where d::date = (now() at time zone 'Asia/Tokyo')::date)
          else (now() at time zone 'Asia/Tokyo')::date >= j.date_start
               and (now() at time zone 'Asia/Tokyo')::date <= coalesce(j.date_end, j.date_start)
        end
    ),
    'todo', (select count(*) from public.my_todo_items()),
    'review_due', (
      select count(*) from public.applications a
      where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
        and a.status = 'completed'
        and a.work_completed_at is not null
        and a.work_completed_at >= now() - interval '3 days'
        and not exists (select 1 from public.reviews r where r.application_id = a.id and r.reviewer_id = auth.uid())
    ),
    'job_revision', (
      select count(*) from public.jobs j
      where j.farmer_id = auth.uid() and j.status = 'draft' and j.revision_requested_at is not null
    )
  );
$function$;
