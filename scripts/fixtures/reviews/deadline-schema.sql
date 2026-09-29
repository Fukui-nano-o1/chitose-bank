-- Local-only schema fixture, using columns referenced by the production functions (2026-09-29).
create table public.account_holders("id" uuid,"auth_id" uuid,"entity_type" text,"created_at" timestamp with time zone);
create table public.applications("id" uuid,"job_number" integer,"worker_id" uuid,"farmer_id" uuid,"status" text,"created_at" timestamp with time zone,"decided_at" timestamp with time zone,"started_at" timestamp with time zone,"work_completed_at" timestamp with time zone,"terms_confirmed_worker_at" timestamp with time zone,"terms_confirmed_farmer_at" timestamp with time zone,"insurance_prepared_at" timestamp with time zone,"attended" boolean,"completion_remind_count" integer,"auto_completed" boolean,"agreed_dates" jsonb);
create table public.employer_profiles("auth_id" uuid,"avatar_url" text,"created_at" timestamp with time zone);
create table public.job_questions("id" uuid,"job_number" integer,"asker_id" uuid,"question" text,"answer" text,"hidden" boolean,"created_at" timestamp with time zone);
create table public.jobs("id" uuid,"farmer_id" uuid,"created_at" timestamp with time zone,"status" text,"crop" text,"task" text,"work_time" text,"job_number" integer,"date_start" date,"date_end" date,"revision_requested_at" timestamp with time zone,"holidays" jsonb);
create table public.messages("id" uuid,"application_id" uuid,"sender_id" uuid,"created_at" timestamp with time zone,"read_at" timestamp with time zone);
create table public.notifications("id" uuid,"farmer_id" uuid,"type" text,"message" text,"created_at" timestamp with time zone);
create table public.repeat_roster("farmer_id" uuid,"worker_id" uuid,"notify" boolean,"source_application_id" uuid,"created_at" timestamp with time zone);
create table public.worker_profiles("auth_id" uuid,"avatar_url" text,"created_at" timestamp with time zone);
CREATE OR REPLACE FUNCTION public.app_phase(a applications)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select case
    when a.status in ('applied','rejected','expired','completed','working','canceled') then a.status
    when a.terms_confirmed_worker_at is not null and a.terms_confirmed_farmer_at is not null then 'contracted'
    else 'interview'
  end
$function$
;
CREATE OR REPLACE FUNCTION public.app_work_dates(p_app uuid)
 RETURNS SETOF date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with a as (
    select ap.agreed_dates, j.date_start, j.date_end, j.holidays
      from public.applications ap
      join public.jobs j on j.job_number = ap.job_number
     where ap.id = p_app
  ),
  hol as (
    select d::date as hd
      from a, lateral (select case when jsonb_typeof(a.holidays)='array' then a.holidays else '[]'::jsonb end as h) hh,
           jsonb_array_elements_text(hh.h) d
  ),
  days as (
    -- agreed_dates（非空配列）があればそれを使う
    select d::date as wd
      from a, jsonb_array_elements_text(a.agreed_dates) d
     where jsonb_typeof(a.agreed_dates)='array' and jsonb_array_length(a.agreed_dates) > 0
    union all
    -- 無ければ求人範囲を展開（★agreed_dates=NULLもこちらへ。coalesceでNULLをfalseに倒す）
    select gs::date
      from a, generate_series(a.date_start, coalesce(a.date_end, a.date_start), interval '1 day') gs
     where not coalesce(jsonb_typeof(a.agreed_dates)='array' and jsonb_array_length(a.agreed_dates) > 0, false)
       and a.date_start is not null
  )
  select distinct wd from days
   where wd not in (select hd from hol);
$function$
;
CREATE OR REPLACE FUNCTION public.app_work_due_at(p_app uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with a as (
    select (select max(d) from public.app_work_dates(p_app) d) as last_wd,
           (select j.work_time from public.applications ap
              join public.jobs j on j.job_number = ap.job_number where ap.id = p_app) as wt
  ),
  t as (
    select last_wd,
           substring(coalesce(wt,'') from '^[[:space:]]*([0-9]{1,2}:[0-9]{2})') as s_txt,
           substring(coalesce(wt,'') from '([0-9]{1,2}:[0-9]{2})[[:space:]]*$')  as e_txt
      from a
  ),
  m as (
    select last_wd,
           case when e_txt is null then null
                else split_part(e_txt,':',1)::int * 60 + split_part(e_txt,':',2)::int end as emin,
           case when s_txt is null then -1
                else split_part(s_txt,':',1)::int * 60 + split_part(s_txt,':',2)::int end as smin
      from t
  ),
  hm as (
    select last_wd,
           case when emin is not null and emin > smin and emin <= 23*60+59 then emin / 60 else 23 end as hh,
           case when emin is not null and emin > smin and emin <= 23*60+59 then emin % 60 else 59 end as mm
      from m
  )
  select case when last_wd is null then null
              else ((last_wd::text || ' ' || lpad(hh::text,2,'0') || ':' || lpad(mm::text,2,'0'))::timestamp)
                   at time zone 'Asia/Tokyo' end
    from hm;
$function$
;
