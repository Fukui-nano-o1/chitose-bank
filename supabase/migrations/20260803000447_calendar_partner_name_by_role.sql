-- get_my_calendar_jobs：partner_name を「この取引での相手の役割」に合わせて解決する（2026-08-03）。
-- 背景：resolve_actor_name は働き手ニックネーム優先のため、両役を持つ相手が農家として出てくる取引でも
-- 働き手名が表示され、「働き手なのに緑（農家色）」に見える食い違いが起きていた（緊急連絡ページで発覚。
-- 例：+worker の働き手面で相手＝farmer の +test/本体 が、雇い手名「千歳農園」「千歳」でなく
-- 働き手名「キムタク」「たき」で出ていた）。
-- 修正：相手が農家（自分=働き手）なら雇い手ニックネーム優先／相手が働き手なら従来どおり働き手優先。
-- 返り値の型・件数・可視範囲は不変（partner_name の解決順のみ）。CREATE OR REPLACE＝権限も不変
-- （PUBLIC/anon/authenticated EXECUTE を適用後に確認済み）。
create or replace function public.get_my_calendar_jobs()
returns table(job_number integer, crop text, task text, date_start date, date_end date, work_time text,
              town text, status text, application_id uuid, application_status text, partner_name text,
              photos jsonb, relation text, my_role text, agreed_dates jsonb,
              terms_confirmed_worker_at timestamptz, terms_confirmed_farmer_at timestamptz)
language sql
security definer
set search_path to 'public'
as $function$
  with app_rows as (
    select
      j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
      a.id as application_id, a.status as application_status,
      case when a.worker_id = auth.uid() then
        -- 相手=農家（この取引の雇い手）：雇い手ニックネーム→働き手ニックネーム→メール先頭2文字→不明
        coalesce(
          (select nullif(ep.nickname,'') from public.employer_profiles ep where ep.auth_id = a.farmer_id),
          (select nullif(wp.nickname,'') from public.worker_profiles wp where wp.auth_id = a.farmer_id),
          (select left(u.email, 2) from auth.users u where u.id = a.farmer_id),
          '不明（' || right(a.farmer_id::text, 6) || '）'
        )
      else
        -- 相手=働き手：従来どおり（resolve_actor_name＝働き手ニックネーム優先）
        public.resolve_actor_name(a.worker_id)
      end as partner_name,
      j.photos,
      'application'::text as relation,
      case when a.worker_id = auth.uid() then 'worker' else 'farmer' end as my_role,
      a.agreed_dates,
      a.terms_confirmed_worker_at,
      a.terms_confirmed_farmer_at
    from public.applications a
    join public.jobs j on j.job_number = a.job_number
    where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
      and a.status = any (array['approved','meeting','interview','contracted','working'])
  ),
  own_rows as (
    select
      j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
      null::uuid, null::text, null::text, j.photos,
      'own'::text, 'farmer'::text, null::jsonb, null::timestamptz, null::timestamptz
    from public.jobs j
    where j.farmer_id = auth.uid()
      and j.date_start is not null
      and not exists (select 1 from app_rows ar where ar.job_number = j.job_number)
  ),
  liked_rows as (
    select
      j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
      null::uuid, null::text, null::text, j.photos,
      'liked'::text, 'worker'::text, null::jsonb, null::timestamptz, null::timestamptz
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
