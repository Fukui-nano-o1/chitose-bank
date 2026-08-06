-- 「完了して評価する」that評価後も消えない不具合の修正（2026-08-06・実機一周で発見）
--
-- 【症状】農家that完了記録＋評価を送った後も、今日ページのやること「完了して評価する」that
-- 3日間残り続ける（件数バッジも減らない）。
--
-- 【原因】fstage の最後の分岐の相関副問い合わせで、応募IDを裸の `id` で書いていた：
--     not exists(select 1 from reviews r where r.application_id = id and r.reviewer_id = uid)
-- 副問い合わせの中では、最も内側のテーブル（reviews）that優先して解決されるため、
-- この `id` は fa.id（応募ID）ではなく reviews.id（評価行のID）に束縛されていた。
-- ＝常に `r.application_id = r.id` という決して成立しない比較になり、
-- 「まだ評価していない」と判定され続けていた。
-- 同じCTE群の finterview（s.application_id = fa.id）・winterview（q.application_id = wa.id）は
-- 正しく修飾されており、ここだけの書き落とし。
--
-- 【実測】修正前：評価送信後も complete that1件残る／`a.id` で書いた同じ述語は0件を返す。
--         修正後：評価前=1件 → 評価後=0件（農家のやること残り0件）。
-- 【この修正】`id` を `fa.id` に修飾するのみ。他の分岐・列・戻り値の型は一切変えていない。

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
             and not exists(select 1 from reviews r where r.application_id = fa.id and r.reviewer_id = uid) then 'complete'
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
