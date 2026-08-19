-- いいねした求人をカレンダーに戻す（2026-08-19たきと指示「いいねは復元」）。
-- 直前の 20260819023252 で「公開中と応募している求人だけ」に絞った際、いいねの行も一緒に落としたthat、
-- いいねは戻す。liked_rows の条件は元のまま＝j.status='open'（公開中のいいねだけ）so、
-- 「公開中と応募している求人だけ」という方針とは矛盾しない（いいねしている公開中の求人＝公開中）。
-- 維持するもの：own_rows は status='open' だけ（終了・審査中・下書きは出さない・前回の絞り込みは不変）。
-- 返り値の列は不変so CREATE OR REPLACE のまま（DROP不要・権限も不変）。
create or replace function public.get_my_calendar_jobs()
returns table(
  job_number integer, crop text, task text, date_start date, date_end date,
  work_time text, town text, status text, application_id uuid, application_status text,
  partner_name text, photos jsonb, relation text, my_role text, agreed_dates jsonb,
  terms_confirmed_worker_at timestamp with time zone, terms_confirmed_farmer_at timestamp with time zone,
  available_dates jsonb, holidays jsonb
)
language sql
security definer
set search_path to 'public'
as $function$
  with app_rows as (
    select
      j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
      a.id as application_id, a.status as application_status,
      case when a.worker_id = auth.uid() then
        -- 相手=農家（この取引の雇い手）：雇い手ニックネーム→働き手ニックネーム→（退会なら「退会した利用者」／通常はメール先頭2文字）→不明
        coalesce(
          (select nullif(ep.nickname,'') from public.employer_profiles ep where ep.auth_id = a.farmer_id),
          (select nullif(wp.nickname,'') from public.worker_profiles wp where wp.auth_id = a.farmer_id),
          (select case when u.email like 'withdrawn+%@withdrawn.invalid' then '退会した利用者' else left(u.email, 2) end
             from auth.users u where u.id = a.farmer_id),
          '不明（' || right(a.farmer_id::text, 6) || '）'
        )
      else
        -- 相手=働き手：resolve_actor_name（働き手ニックネーム優先・退会対応込み）
        public.resolve_actor_name(a.worker_id)
      end as partner_name,
      j.photos,
      'application'::text as relation,
      case when a.worker_id = auth.uid() then 'worker' else 'farmer' end as my_role,
      a.agreed_dates,
      a.terms_confirmed_worker_at,
      a.terms_confirmed_farmer_at,
      a.available_dates,
      j.holidays
    from public.applications a
    join public.jobs j on j.job_number = a.job_number
    where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
      and a.status = any (array['approved','meeting','interview','contracted','working'])
  ),
  own_rows as (
    select
      j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
      null::uuid, null::text, null::text, j.photos,
      'own'::text, 'farmer'::text, null::jsonb, null::timestamptz, null::timestamptz,
      null::jsonb, j.holidays
    from public.jobs j
    where j.farmer_id = auth.uid()
      and j.status = 'open'          -- 公開中だけ（終了・審査中・下書きは出さない）
      and j.date_start is not null
      and not exists (select 1 from app_rows ar where ar.job_number = j.job_number)
  ),
  liked_rows as (
    select
      j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
      null::uuid, null::text, null::text, j.photos,
      'liked'::text, 'worker'::text, null::jsonb, null::timestamptz, null::timestamptz,
      null::jsonb, j.holidays
    from public.saved_jobs sv
    join public.jobs j on j.job_number = sv.job_number
    where sv.worker_id = auth.uid()
      and j.status = 'open'          -- 公開中のいいねだけ（終了した求人のいいねは出さない）
      and j.date_start is not null
      and j.farmer_id <> auth.uid()
      and not exists (select 1 from app_rows ar where ar.job_number = j.job_number)
  )
  select * from app_rows
  union all select * from own_rows
  union all select * from liked_rows
$function$;
