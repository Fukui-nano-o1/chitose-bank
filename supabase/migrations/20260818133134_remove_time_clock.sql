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

-- ── ① ② ③ の窓口を落とす ──────────────────────────────
drop function if exists public.punch_start(uuid, timestamptz);
drop function if exists public.request_time_correction(uuid, timestamptz, timestamptz, text);
drop function if exists public.decide_time_correction(uuid, boolean);
drop function if exists public.confirm_start(uuid);
drop function if exists public.confirm_end(uuid);

-- ── ② 修正申請の台帳。記録が1行でもあれば中止する（記録の憲法）──────
do $$
begin
  if (select count(*) from public.attendance_corrections) > 0 then
    raise exception '打刻の修正申請の記録が残っています。記録を消さないため中止します';
  end if;
end $$;
drop table public.attendance_corrections;

-- ── バッジ：打刻修正の承認待ちを数えない ────────────────────
create or replace function public.my_nav_badges()
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
        and (now() at time zone 'Asia/Tokyo')::date between j.date_start and coalesce(j.date_end, j.date_start)
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
        and not exists (select 1 from public.reviews r
                         where r.application_id = a.id and r.reviewer_id = auth.uid())
    ),
    'job_revision', (
      select count(*) from public.jobs j
      where j.farmer_id = auth.uid() and j.status = 'draft' and j.revision_requested_at is not null
        and coalesce(j.date_end, j.date_start) >= (now() at time zone 'Asia/Tokyo')::date
    )
  );
$function$;

-- ── やること ───────────────────────────────────────
-- ・farmer の 'confirm_start'（開始を確認）を廃止
-- ・farmer の 'complete'（完了して評価）の条件を farmer_confirmed_start_at → started_at に
--   ＝自動開始が入った時点で完了の用件が立つ（開始確認を廃止しても用件が永久に出ない事故を防ぐ）
-- ・worker の 'w_start'（作業を開始する）を廃止＝押させる箱が無いのに件数だけ数えていたのも直る
-- ・worker の 'w_review'（評価）の条件を worker_confirmed_end_at → 評価の行の有無に
--   ＝終了確認を廃止しても、評価を書けば用件が消える（記録から導出）
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
           u.uid, u.today
    from applications a join jobs j on j.job_number = a.job_number, u
    where a.farmer_id = u.uid
  ),
  fstage as (
    select 'farmer'::text my_role,
      case
        when status = 'applied' then 'approve'
        when status in ('approved','meeting','interview','contracted','working') and started_at is not null and status <> 'completed' then 'complete'
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
      case when started_at is not null then today
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
           u.uid, u.today
    from applications a join jobs j on j.job_number = a.job_number, u
    where a.worker_id = u.uid
  ),
  wstage as (
    select 'worker'::text my_role,
      case
        when status = 'completed' and attended is distinct from false
             and work_completed_at is not null and work_completed_at >= now() - interval '3 days'
             and not exists(select 1 from reviews r where r.application_id = wa.id and r.reviewer_id = uid) then 'w_review'
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
