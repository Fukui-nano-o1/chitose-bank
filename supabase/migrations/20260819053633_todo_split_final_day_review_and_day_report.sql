-- 評価フローを作業日で二分する（2026-08-19たきと指示）。
--   最終作業日（以降）＝全体の評価（complete / w_review）＝全工程の終了を意味する
--   それ以外の作業日   ＝その日の記録（day_report / w_day_report）＝遅刻・欠勤・相手が来ない
-- ★実働日は app_work_dates（agreed_dates ＞ 求人期間、holidays を除く）＝
--   二重予約の壁・フロントの lastAppWorkDay と同じ物差し。3つを揃えて変えること。
-- ★日程が分からない求人（date_start も agreed_dates も無い）は last_wd が null になるので
--   coalesce(last_wd, today) で「最終日に達した」に倒す＝評価の道を塞がない。
--   逆に その日の記録 は last_wd が null なら出さない（中日を特定できないため）。
create or replace function public.my_todo_items()
 returns table(my_role text, stage text, job_number integer, application_id uuid, crop text, task text, partner_name text, partner_avatar text, partner_id uuid, date_start date, date_end date, work_time text, agreed_dates jsonb, sort_key date)
 language sql
 security definer
 set search_path to 'public'
as $function$
  with u as (select auth.uid() as uid, (now() at time zone 'Asia/Tokyo')::date as today),
  rev as (
    select 'farmer'::text my_role, 'revision'::text stage, j.job_number, null::uuid application_id,
           j.crop, j.task, null::text partner_name, null::text partner_avatar, null::uuid partner_id,
           j.date_start, j.date_end, j.work_time, null::jsonb agreed_dates,
           u.today sort_key
    from jobs j, u
    where j.farmer_id = u.uid and j.status = 'draft' and j.revision_requested_at is not null
      and coalesce(j.date_end, j.date_start) >= u.today
  ),
  fq as (
    select 'farmer'::text my_role, 'question'::text stage, q.job_number, q.id application_id,
           j.crop, j.task,
           public.resolve_actor_name(q.asker_id) partner_name,
           (select wp.avatar_url from worker_profiles wp where wp.auth_id = q.asker_id) partner_avatar,
           q.asker_id partner_id,
           j.date_start, j.date_end, j.work_time, null::jsonb agreed_dates,
           u.today sort_key
    from job_questions q join jobs j on j.job_number = q.job_number, u
    where j.farmer_id = u.uid and coalesce(q.answer, '') = '' and q.hidden = false
  ),
  fa as (
    select a.id, a.status, a.job_number, a.agreed_dates, a.started_at,
           a.insurance_prepared_at, a.work_completed_at, a.terms_confirmed_farmer_at,
           a.worker_id partner_id,
           j.crop, j.task, j.date_start, j.date_end, j.work_time,
           public.resolve_actor_name(a.worker_id) partner_name,
           (select wp.avatar_url from worker_profiles wp where wp.auth_id = a.worker_id) partner_avatar,
           exists(select 1 from messages m where m.application_id = a.id and m.sender_id <> u.uid and m.read_at is null) unread,
           (select max(d) from public.app_work_dates(a.id) d) last_wd,
           exists(select 1 from public.app_work_dates(a.id) d where d = u.today) is_wd,
           u.uid, u.today
    from applications a join jobs j on j.job_number = a.job_number, u
    where a.farmer_id = u.uid
  ),
  fstage as (
    select 'farmer'::text my_role,
      case
        when status = 'applied' then 'approve'
        -- 全体の評価は最終作業日に達してから（中日は下の day_report が受け持つ）
        when status in ('approved','meeting','interview','contracted','working') and started_at is not null and status <> 'completed'
             and today >= coalesce(last_wd, today) then 'complete'
        when status in ('approved','meeting','interview','contracted','working') and insurance_prepared_at is null
             and not exists (select 1 from employer_profiles ep,
                                   jsonb_array_elements_text(ep.insurance_items) it
                              where ep.auth_id = uid
                                and jsonb_typeof(ep.insurance_items) = 'array'
                                and it <> 'considering') then 'insurance'
        when status = 'completed' and work_completed_at is not null and work_completed_at >= now() - interval '24 hours'
             and not exists(select 1 from reviews r where r.application_id = fa.id and r.reviewer_id = uid) then 'complete'
        else null
      end stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      case when started_at is not null then today
           else coalesce(date_start, today) end sort_key
    from fa
  ),
  fhire as (
    select 'farmer'::text my_role, 'hire'::text stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      coalesce(date_start, today) sort_key
    from fa
    where status in ('approved','meeting','interview') and terms_confirmed_farmer_at is null
  ),
  -- その日の記録（農家）：作業中で、今日が実働日で、まだ最終日ではない日だけ。
  -- CASE ではなく独立した枝にしてある＝保険の報告など他の用件と同時に並べられる
  fday as (
    select 'farmer'::text my_role, 'day_report'::text stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      today sort_key
    from fa
    where status = 'working' and last_wd is not null and today < last_wd and is_wd
  ),
  wa as (
    select a.id, a.status, a.job_number, a.agreed_dates,
           a.terms_confirmed_worker_at, a.attended, a.work_completed_at,
           a.farmer_id partner_id,
           j.crop, j.task, j.date_start, j.date_end, j.work_time,
           public.resolve_actor_name(a.farmer_id) partner_name,
           (select ep.avatar_url from employer_profiles ep where ep.auth_id = a.farmer_id) partner_avatar,
           exists(select 1 from messages m where m.application_id = a.id and m.sender_id <> u.uid and m.read_at is null) unread,
           ((u.today between j.date_start and coalesce(j.date_end, j.date_start))
            or (a.agreed_dates is not null and jsonb_typeof(a.agreed_dates) = 'array'
                and exists(select 1 from jsonb_array_elements_text(a.agreed_dates) d where d::date = u.today))) is_work_day,
           (select max(d) from public.app_work_dates(a.id) d) last_wd,
           exists(select 1 from public.app_work_dates(a.id) d where d = u.today) is_wd,
           u.uid, u.today
    from applications a join jobs j on j.job_number = a.job_number, u
    where a.worker_id = u.uid
  ),
  wstage as (
    select 'worker'::text my_role,
      case
        -- 全体の評価は最終作業日に達してから（中日は下の w_day_report が受け持つ）
        when status = 'working' and attended is distinct from false
             and today >= coalesce(last_wd, today)
             and not exists(select 1 from reviews r where r.application_id = wa.id and r.reviewer_id = uid) then 'w_review'
        when status = 'completed' and attended is distinct from false
             and work_completed_at is not null and work_completed_at >= now() - interval '24 hours'
             and not exists(select 1 from reviews r where r.application_id = wa.id and r.reviewer_id = uid) then 'w_review'
        else null
      end stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      case when is_work_day then today else coalesce(date_start, today) end sort_key
    from wa
  ),
  -- その日の記録（働き手）：作業中で、今日が実働日で、まだ最終日ではない日だけ
  wday as (
    select 'worker'::text my_role, 'w_day_report'::text stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      today sort_key
    from wa
    where status = 'working' and last_wd is not null and today < last_wd and is_wd
  )
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from rev
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from fq
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from fstage where stage is not null
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from fhire
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from fday
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from wstage where stage is not null
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from wday
$function$;
