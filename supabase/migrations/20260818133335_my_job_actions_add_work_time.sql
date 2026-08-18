-- my_job_actions に work_time を追加（2026-08-18たきと指示「当日の労働終了時刻から緑に戻せ」）。
-- ステータスページが「いま働いている時間か」を判定するのに勤務時間が要る（帯・アイコンの色）。
-- ★戻り値の列が増える＝create or replace では変えられない（cannot change return type）ため drop→create。
--   作り直すと default privileges が anon にも EXECUTE を付けるので、from public と from anon の
--   両方に revoke してから authenticated へ grant し直す（2026-08-06の教訓）。
-- 本体のロジック・列の並びは不変（末尾に work_time を足しただけ）。
drop function if exists public.my_job_actions();
create or replace function public.my_job_actions()
returns table(job_number integer, crop text, task text, photos jsonb, date_start date, date_end date,
              town text, job_status text, liked boolean, application_id uuid, application_status text,
              applied_at timestamp with time zone, terms_confirmed_worker_at timestamp with time zone,
              terms_confirmed_farmer_at timestamp with time zone, available_dates jsonb, agreed_dates jsonb,
              rejected_reason text, work_time text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select distinct on (j.job_number)
    j.job_number, j.crop, j.task, j.photos, j.date_start, j.date_end, j.town, j.status as job_status,
    (s.job_number is not null) as liked,
    a.id as application_id, a.status as application_status, a.created_at as applied_at,
    a.terms_confirmed_worker_at, a.terms_confirmed_farmer_at, a.available_dates, a.agreed_dates,
    a.rejected_reason, j.work_time
  from public.jobs j
  left join public.saved_jobs   s on s.job_number = j.job_number and s.worker_id = auth.uid()
  left join public.applications a on a.job_number = j.job_number and a.worker_id = auth.uid()
  where auth.uid() is not null
    and j.farmer_id <> auth.uid()
    and (s.job_number is not null or a.id is not null)
  order by j.job_number desc, a.created_at desc nulls last;
$function$;
revoke all on function public.my_job_actions() from public, anon;
grant execute on function public.my_job_actions() to authenticated;
