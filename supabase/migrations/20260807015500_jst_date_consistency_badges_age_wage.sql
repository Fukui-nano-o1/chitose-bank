-- 素の current_date（＝DBのUTC日付）をJST日付に統一（2026-08-06 バグ狩り③で発見）。
-- DBは UTC 稼働so current_date は UTC 日付。コードベースの日付規約は
-- 「(now() at time zone 'Asia/Tokyo')::date」で統一されている（auto_start_work・complete_work・
-- expire_stale_applications 等が明示的にJST日付を使う）。3関数だけ素の current_date を使い、
-- JST 00:00〜08:59（UTC 15:00〜23:59）の約9時間、日付が1日ズレていた。
-- 実測：UTC 22:30 で current_date=8/6・JST日付=8/7。
--
-- ★本命バグ：my_nav_badges の calendar_today／job_revision
--   ＝JST早朝（働き手が農園へ向かう時間帯）に「今日の予定」バッジがその日の求人を数えず、
--     前日扱いになる。他のカレンダー系（get_my_calendar_jobs 等）は現在JSTで正しいのにバッジだけズレていた。
-- 併せて整合修理：
--   ・enforce_min_age＝18歳判定。UTC基準だとJST早朝に「本日18歳」の人を約9時間だけ過剰拒否していた
--     （安全側だがJSTが正＝日本の年齢はJSTで数える）。実測：誕生日当日の人を旧=拒否／新=許可。
--   ・get_minimum_wage＝最賃の発効日照合。掲載トリガー(trg_job_publish_snapshot)は既にJST日付で引くのに
--     この関数だけUTC＝不整合（発効日切替の当日9時間だけ食い違う）。
-- 検証済み（JST早朝を模擬した固定時刻で式を検算）：旧UTC式は今日の求人を数えず・18歳を過剰拒否／
--   新JST式は両方正しい。my_nav_badges の返り値の構造・キーは不変。

create or replace function public.my_nav_badges()
 returns json language sql stable security definer set search_path to 'public'
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
    'todo', (
      (select count(*) from public.my_todo_items())
      + (select count(*) from public.attendance_corrections c
           join public.applications a on a.id = c.application_id
          where c.status = 'pending'
            and c.requested_by <> auth.uid()
            and auth.uid() in (a.worker_id, a.farmer_id))
    ),
    'time_corrections', (
      select count(*) from public.attendance_corrections c
        join public.applications a on a.id = c.application_id
       where c.status = 'pending'
         and c.requested_by <> auth.uid()
         and auth.uid() in (a.worker_id, a.farmer_id)
    ),
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

create or replace function public.enforce_min_age()
 returns trigger language plpgsql
as $function$
begin
  if new.birth_date > ((now() at time zone 'Asia/Tokyo')::date - interval '18 years') then
    raise exception '18歳未満は登録できません';
  end if;
  return new;
end;
$function$;

create or replace function public.get_minimum_wage(p_prefecture text)
 returns integer language sql stable set search_path to 'public'
as $function$
  select hourly_wage
  from public.minimum_wages
  where prefecture = p_prefecture
    and effective_from <= (now() at time zone 'Asia/Tokyo')::date
  order by effective_from desc
  limit 1;
$function$;
