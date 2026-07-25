-- 保険の報告は「保険の準備（プロフィール）が未設定の雇い手」のみ該当に変更（2026-07-25たきと指示）。
-- 設定済み（employer_profiles.insurance_items に1つ以上選択あり）の雇い手には応募ごとの報告を求めない。
-- my_todo_items v6（v5=interview/hire追加からの差分はinsurance条件のみ）：
--   ・partner_id を追加（農家行=worker_id／働き手行=farmer_id。採用時の二重予約チェックに使用）
--   ・農家の独立段2つを追加（従来のcase連鎖とは別UNION＝他の用事と同時に出る）：
--       interview ＝ 面接の質問を送る（承認済み・採用前・この応募に質問集【面接の質問】を未投函）
--       hire      ＝ 採用する（承認済み・採用前＝terms_confirmed_farmer_at が null）
--   ・働き手の求人内容の確認（w_confirm）は従来どおり（フロント側でその場実行に変更）
-- RETURNS TABLE の列変更のため DROP→CREATE（呼び出し元は TodayPage のみ）。
drop function if exists public.my_todo_items();
create or replace function public.my_todo_items()
 returns table(my_role text, stage text, job_number integer, application_id uuid,
   crop text, task text, partner_name text, partner_avatar text, partner_id uuid,
   date_start date, date_end date, work_time text, agreed_dates jsonb, sort_key date)
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
             and not exists (select 1 from employer_profiles ep
                              where ep.auth_id = uid and ep.insurance_items is not null
                                and jsonb_typeof(ep.insurance_items) = 'array'
                                and jsonb_array_length(ep.insurance_items) > 0) then 'insurance'
        when status = 'completed' and work_completed_at is not null and work_completed_at >= now() - interval '3 days'
             and not exists(select 1 from reviews r where r.application_id = id and r.reviewer_id = uid) then 'review'
        when unread then 'chat'
        else null
      end stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      case when started_at is not null or farmer_confirmed_start_at is not null then today
           else coalesce(date_start, today) end sort_key
    from fa
  ),
  finterview as ( -- 面接の質問を送る（チャットからの移設・独立段so他の用事と同時に出る）
    select 'farmer'::text my_role, 'interview'::text stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      coalesce(date_start, today) sort_key
    from fa
    where status in ('approved','meeting','interview') and terms_confirmed_farmer_at is null
      and not exists (select 1 from messages m
                       where m.application_id = fa.id and m.sender_id = fa.uid
                         and m.body like '【面接の質問】%')
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
        when status = 'applied' then 'w_waiting'
        when status in ('approved','meeting','interview','contracted','working') and terms_confirmed_worker_at is null then 'w_confirm'
        when status in ('approved','meeting','interview','contracted','working') and is_work_day and started_at is null then 'w_start'
        when status = 'completed' and attended is distinct from false and worker_confirmed_end_at is null
             and work_completed_at is not null and work_completed_at >= now() - interval '3 days' then 'w_review'
        when unread then 'chat'
        else null
      end stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      case when is_work_day then today else coalesce(date_start, today) end sort_key
    from wa
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
$function$;
grant execute on function public.my_todo_items() to authenticated;
