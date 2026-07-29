-- 「終了は終了、下書きは下書き」（2026-07-27たきと指示）。
-- 求人の状態の定義がフロント・DBで揃っておらず、作業日程が過ぎた求人（＝終了）が
-- status='draft' のまま「修正のお願い」の宿題として数えられていた。日程が過ぎた求人は
-- 直して出し直せないので、宿題からも用件リストからも外す。
--   終了＝coalesce(date_end, date_start) < 今日（statusより優先）
--   下書き＝掲載歴なし（opened_at is null）かつ 未終了 の draft
--   一時非公開＝掲載歴あり（opened_at is not null）の draft
-- 対象は①my_nav_badges の job_revision ②my_todo_items の rev 段（農家の「修正のお願い」）。
-- フロント側は lib/utils の isJobEnded / isJobDraft / isJobUnpublished に一本化済み。
--
-- ※本ファイルは、実DBに適用済みの定義をそのまま写経したもの（repo=正本の原則・2026-07-21）。
--   本文は他端末が育てた現行版であり、日程ガード2行のみが本コミットでの追加分。

-- ① 下部ナビ「求人」の⚠（修正のお願い）：終了した求人は数えない
CREATE OR REPLACE FUNCTION public.my_nav_badges()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select json_build_object(
    'chat_threads', (
      select count(distinct a.id) from public.applications a
      where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
        and a.status <> 'completed'
        and exists (select 1 from public.messages m
                    where m.application_id = a.id and m.sender_id <> auth.uid() and m.read_at is null)
    ),
    'calendar_today', (
      select count(*) from public.applications a
      join public.jobs j on j.job_number = a.job_number
      where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
        and a.status in ('contracted','working')
        and current_date between j.date_start and coalesce(j.date_end, j.date_start)
    ),
    'todo', (select count(*) from public.my_todo_items()),
    'applicants_pending', (
      select count(*) from public.applications a
      where a.farmer_id = auth.uid() and a.status = 'applied'
    ),
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
        -- ★終了した求人は修正できないので数えない（2026-07-27）
        and coalesce(j.date_end, j.date_start) >= current_date
    )
  );
$function$;

-- ② やること（農家）の「求人に修正のお願い」段：同じく終了した求人は出さない
CREATE OR REPLACE FUNCTION public.my_todo_items()
 RETURNS TABLE(my_role text, stage text, job_number integer, application_id uuid, crop text, task text, partner_name text, partner_avatar text, partner_id uuid, date_start date, date_end date, work_time text, agreed_dates jsonb, sort_key date)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with u as (select auth.uid() as uid, (now() at time zone 'Asia/Tokyo')::date as today),
  rev as (
    select 'farmer'::text my_role, 'revision'::text stage, j.job_number, null::uuid application_id,
           j.crop, j.task, null::text partner_name, null::text partner_avatar, null::uuid partner_id,
           j.date_start, j.date_end, j.work_time, null::jsonb agreed_dates,
           u.today sort_key
    from jobs j, u
    where j.farmer_id = u.uid and j.status = 'draft' and j.revision_requested_at is not null
      -- ★終了した求人は直して出し直せないので用件にしない（2026-07-27）
      and coalesce(j.date_end, j.date_start) >= u.today
  ),
  fq as ( -- 求人への質問（公開Q&A）：自分の求人の、回答なし・非表示でない質問
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
             and not exists(select 1 from reviews r where r.application_id = id and r.reviewer_id = uid) then 'complete'
        else null
      end stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      case when started_at is not null or farmer_confirmed_start_at is not null then today
           else coalesce(date_start, today) end sort_key
    from fa
  ),
  finterview as (
    select 'farmer'::text my_role, 'interview'::text stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      coalesce(date_start, today) sort_key
    from fa
    where status in ('approved','meeting','interview') and terms_confirmed_farmer_at is null
      and not exists (select 1 from interview_question_sends s
                       where s.application_id = fa.id)
  ),
  fhire as (
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
        else null
      end stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      case when is_work_day then today else coalesce(date_start, today) end sort_key
    from wa
  ),
  winterview as (
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
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from fq
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
