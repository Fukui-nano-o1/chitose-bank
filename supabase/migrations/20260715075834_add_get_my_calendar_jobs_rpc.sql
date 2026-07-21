create or replace function public.get_my_calendar_jobs()
returns table (
  job_number int,
  crop text,
  task text,
  date_start date,
  date_end date,
  work_time text,
  town text,
  status text,
  application_id uuid,
  application_status text,
  partner_name text
)
language sql
security definer
set search_path = public
as $$
  select
    j.job_number,
    j.crop,
    j.task,
    j.date_start,
    j.date_end,
    j.work_time,
    j.town,
    j.status,
    a.id as application_id,
    a.status as application_status,
    public.resolve_actor_name(
      case when a.worker_id = auth.uid() then a.farmer_id else a.worker_id end
    ) as partner_name
  from public.applications a
  join public.jobs j on j.job_number = a.job_number
  where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
    and a.status = any (array['approved','meeting','interview','contracted','working','completed'])
$$;

grant execute on function public.get_my_calendar_jobs() to authenticated;
