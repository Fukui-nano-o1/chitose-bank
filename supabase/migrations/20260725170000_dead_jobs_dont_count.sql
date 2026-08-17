-- 失効・完了の求人は「もうない求人」＝カウントしない（2026-07-25たきと指示）。
-- ①my_todo_items：未読チャット段(chat)が失効・完了の応募でも発火していた→ unread かつ 非(失効/完了) に限定。
--   評価（review/w_review・完了後3日以内）は完了フローの正規最終段ので残す。
--   ※本関数はdrop_w_waiting（w_waiting削除・他端末）との相互上書きが発生したため、
--     本版=「w_waiting削除＋面接質問は送信履歴基準＋chat除外」の統合版（DB適用・検収済み）
-- ②my_nav_badges：chat_threads（下部ナビのチャットバッジ）から completed を除外（expiredは元から対象外）
-- ③my_unread_message_counts：チャット未読合計・アプリアイコンバッジから completed を除外

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
         and a.status in ('applied','approved','meeting','interview','contracted','working','rejected')
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

create or replace function public.my_unread_message_counts()
 returns json
 language sql
 security definer
 set search_path to 'public'
as $function$
  SELECT json_build_object(
    'chat', (SELECT count(*) FROM messages m JOIN applications a ON a.id = m.application_id
             WHERE (a.worker_id = auth.uid() OR a.farmer_id = auth.uid())
               AND a.status IN ('applied','approved','meeting','interview','contracted','working','rejected')
               AND m.sender_id <> auth.uid() AND m.read_at IS NULL),
    'dm', (SELECT count(*) FROM admin_messages am
           WHERE am.user_id = auth.uid() AND am.from_admin AND am.read_at IS NULL),
    'by_application', (SELECT coalesce(json_object_agg(t.application_id, t.cnt), '{}'::json) FROM (
        SELECT m.application_id, count(*) AS cnt
        FROM messages m JOIN applications a ON a.id = m.application_id
        WHERE (a.worker_id = auth.uid() OR a.farmer_id = auth.uid())
          AND a.status IN ('applied','approved','meeting','interview','contracted','working','rejected')
          AND m.sender_id <> auth.uid() AND m.read_at IS NULL
        GROUP BY m.application_id) t)
  );
$function$;

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
  ),
  fa as (
    select a.id, a.status, a.job_number, a.agreed_dates, a.started_at, a.farmer_confirmed_start_at,
           a.insurance_prepared_at, a.work_completed_at, a.terms_confirmed_farmer_at,
           a.worker_id partner_id,
           j.crop, j.task, j.date_start, j.date_end, j.work_time,
           public.resolve_actor_name(a.worker_id) partner_name,
           (select wp.avatar_url from worker_profiles wp where wp.auth_id = a.worker_id) partner_avatar,
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
        when status in ('approved','meeting','interview','contracted','working') and insurance_prepared_at is null
             and not exists (select 1 from employer_profiles ep,
                                   jsonb_array_elements_text(ep.insurance_items) it
                              where ep.auth_id = uid
                                and jsonb_typeof(ep.insurance_items) = 'array'
                                and it <> 'considering') then 'insurance'
        when status = 'completed' and work_completed_at is not null and work_completed_at >= now() - interval '3 days'
             and not exists(select 1 from reviews r where r.application_id = id and r.reviewer_id = uid) then 'review'
        when unread and status not in ('expired','completed') then 'chat'
        else null
      end stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      case when started_at is not null or farmer_confirmed_start_at is not null then today
           else coalesce(date_start, today) end sort_key
    from fa
  ),
  finterview as ( -- 面接の質問を送る：送信履歴（interview_question_sends）が無い応募だけ計上
    select 'farmer'::text my_role, 'interview'::text stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      coalesce(date_start, today) sort_key
    from fa
    where status in ('approved','meeting','interview') and terms_confirmed_farmer_at is null
      and not exists (select 1 from interview_question_sends s
                       where s.application_id = fa.id)
  ),
  fhire as ( -- 採用する（チャットの採用ボタンの移設・独立段）
    select 'farmer'::text my_role, 'hire'::text stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      coalesce(date_start, today) sort_key
    from fa
    where status in ('approved','meeting','interview') and terms_confirmed_farmer_at is null
  ),
  wa as (
    select a.id, a.status, a.job_number, a.agreed_dates, a.started_at, a.worker_confirmed_end_at,
           a.terms_confirmed_worker_at, a.attended, a.work_completed_at,
           a.farmer_id partner_id,
           j.crop, j.task, j.date_start, j.date_end, j.work_time,
           public.resolve_actor_name(a.farmer_id) partner_name,
           (select ep.avatar_url from employer_profiles ep where ep.auth_id = a.farmer_id) partner_avatar,
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
        when status in ('approved','meeting','interview','contracted','working') and is_work_day and started_at is null then 'w_start'
        when status = 'completed' and attended is distinct from false and worker_confirmed_end_at is null
             and work_completed_at is not null and work_completed_at >= now() - interval '3 days' then 'w_review'
        when unread and status not in ('expired','completed') then 'chat'
        else null
      end stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      case when is_work_day then today else coalesce(date_start, today) end sort_key
    from wa
  ),
  winterview as ( -- 面接の回答（働き手・独立段）：最後の【面接の質問】以降に自分の返信が無い
    select 'worker'::text my_role, 'w_interview'::text stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      coalesce(date_start, today) sort_key
    from wa
    where status in ('approved','meeting','interview')
      and exists (select 1 from messages q
                   where q.application_id = wa.id and q.sender_id = wa.partner_id
                     and q.body like '【面接の質問】%'
                     and not exists (select 1 from messages r
                                      where r.application_id = wa.id and r.sender_id = wa.uid
                                        and r.created_at > q.created_at))
  )
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from rev
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from fstage where stage is not null
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from finterview
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from fhire
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from wstage where stage is not null
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from winterview
$function$;
