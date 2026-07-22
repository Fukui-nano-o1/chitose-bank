-- カレンダーの役割色（第11弾・2026-07-22）：各予定が「農家として（own/受け取った応募）」か
-- 「働き手として（応募・いいね）」かを my_role で返す。application行は自分がworker/farmerどちら側かで分岐。
-- 戻り値に列を追加するため DROP してから再作成する。
drop function if exists public.get_my_calendar_jobs();
create or replace function public.get_my_calendar_jobs()
 returns table(job_number integer, crop text, task text, date_start date, date_end date, work_time text, town text, status text, application_id uuid, application_status text, partner_name text, photos jsonb, relation text, my_role text)
 language sql
 security definer
 set search_path to 'public'
as $function$
  with app_rows as (
    select
      j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
      a.id as application_id, a.status as application_status,
      public.resolve_actor_name(
        case when a.worker_id = auth.uid() then a.farmer_id else a.worker_id end
      ) as partner_name,
      j.photos,
      'application'::text as relation,
      case when a.worker_id = auth.uid() then 'worker' else 'farmer' end as my_role
    from public.applications a
    join public.jobs j on j.job_number = a.job_number
    where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
      and a.status = any (array['approved','meeting','interview','contracted','working'])
  ),
  own_rows as (
    select
      j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
      null::uuid, null::text, null::text, j.photos,
      'own'::text, 'farmer'::text
    from public.jobs j
    where j.farmer_id = auth.uid()
      and j.date_start is not null
      and not exists (select 1 from app_rows ar where ar.job_number = j.job_number)
  ),
  liked_rows as (
    select
      j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
      null::uuid, null::text, null::text, j.photos,
      'liked'::text, 'worker'::text
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
$function$;

grant execute on function public.get_my_calendar_jobs() to authenticated;
