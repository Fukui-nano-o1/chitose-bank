-- 集合場所の公開粒度を「町域まで」に引き上げる。
-- jobs.address（番地・建物名）は引き続き非公開。承認後にのみ開示する。
alter table public.jobs add column if not exists town text;

comment on column public.jobs.town is '町域（例：山川町〇〇）。公開する。jobs_public に含む。';
comment on column public.jobs.address is '番地・建物名。非公開。承認後にのみ開示する。jobs_public に含めてはならない。';

drop view if exists public.jobs_public;

create view public.jobs_public
with (security_invoker = false) as
  select job_number,
         crop,
         task,
         prefecture,
         city,
         town,
         date_label,
         date_start,
         date_end,
         headcount,
         pay_type,
         hourly_wage,
         daily_wage,
         work_time,
         break_time,
         nearest_station,
         commute_time,
         job_exp,
         notes,
         belongings,
         cautions,
         danger_places,
         danger_tasks,
         photos,
         created_at
    from public.jobs
   where status = 'open'::text;

grant select on public.jobs_public to anon, authenticated;