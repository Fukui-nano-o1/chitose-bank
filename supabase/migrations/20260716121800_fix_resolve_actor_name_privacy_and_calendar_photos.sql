-- ① resolve_actor_name：本名(account_holders.full_name)・メール全文へのフォールバックを廃止（本名公開禁止の制約に整合）。
--    優先順：働き手ニックネーム → 雇い手ニックネーム → メール先頭2文字 → 不明(…)
create or replace function public.resolve_actor_name(p_auth_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(nickname,'') from public.worker_profiles where auth_id = p_auth_id),
    (select nullif(nickname,'') from public.employer_profiles where auth_id = p_auth_id),
    (select left(email, 2) from auth.users where id = p_auth_id),
    '不明（' || right(p_auth_id::text, 6) || '）'
  );
$$;

-- ② get_my_calendar_jobs：カレンダーカードの写真表示用に photos を追加（返り値型の変更のためdrop→create）
drop function if exists public.get_my_calendar_jobs();
create function public.get_my_calendar_jobs()
returns table(job_number integer, crop text, task text, date_start date, date_end date, work_time text, town text, status text, application_id uuid, application_status text, partner_name text, photos jsonb)
language sql
security definer
set search_path = public
as $$
  select
    j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
    a.id as application_id, a.status as application_status,
    public.resolve_actor_name(
      case when a.worker_id = auth.uid() then a.farmer_id else a.worker_id end
    ) as partner_name,
    j.photos
  from public.applications a
  join public.jobs j on j.job_number = a.job_number
  where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
    and a.status = any (array['approved','meeting','interview','contracted','working','completed'])
$$;
grant execute on function public.get_my_calendar_jobs() to authenticated;