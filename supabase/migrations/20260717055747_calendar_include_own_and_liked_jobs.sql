-- カレンダーに関連する求人をすべて載せる（2026-07-16）：
-- ①応募ベース（従来どおり・承認以降）②自分の求人（下書き/審査中/公開中）③いいねした公開中求人。
-- relation列（application/own/liked）で由来を返し、フロントの帯表示に使う。返り値型が変わるためDROP→CREATE
drop function public.get_my_calendar_jobs();

create function public.get_my_calendar_jobs()
returns table(
  job_number integer, crop text, task text, date_start date, date_end date,
  work_time text, town text, status text,
  application_id uuid, application_status text, partner_name text, photos jsonb,
  relation text
)
language sql
security definer
set search_path to 'public'
as $$
  with app_rows as (
    select
      j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
      a.id as application_id, a.status as application_status,
      public.resolve_actor_name(
        case when a.worker_id = auth.uid() then a.farmer_id else a.worker_id end
      ) as partner_name,
      j.photos,
      'application'::text as relation
    from public.applications a
    join public.jobs j on j.job_number = a.job_number
    where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
      and a.status = any (array['approved','meeting','interview','contracted','working','completed'])
  ),
  own_rows as (
    select
      j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
      null::uuid, null::text, null::text, j.photos,
      'own'::text
    from public.jobs j
    where j.farmer_id = auth.uid()
      and j.date_start is not null
      and not exists (select 1 from app_rows ar where ar.job_number = j.job_number)
  ),
  liked_rows as (
    select
      j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
      null::uuid, null::text, null::text, j.photos,
      'liked'::text
    from public.saved_jobs sv
    join public.jobs j on j.job_number = sv.job_number
    where sv.worker_id = auth.uid()
      and j.status = 'open'
      and j.date_start is not null
      and j.farmer_id <> auth.uid()
      and not exists (select 1 from app_rows ar where ar.job_number = j.job_number)
  )
  select * from app_rows
  union all select * from own_rows
  union all select * from liked_rows
$$;

revoke all on function public.get_my_calendar_jobs() from public;
revoke all on function public.get_my_calendar_jobs() from anon;
grant execute on function public.get_my_calendar_jobs() to authenticated;