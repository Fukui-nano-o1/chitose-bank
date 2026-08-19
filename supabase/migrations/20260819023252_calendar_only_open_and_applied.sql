-- カレンダーに出すのは【公開中の求人】と【応募している求人】だけ（2026-08-19たきと指示）。
-- これまでは①自分の求人that掲載の状態を問わず出ていた（終了・審査中・一度公開した下書きまで）
-- ②いいねしただけの求人も出ていた（応募していない＝予定ではない）。
-- 実測（変更前）：自分の求人＝終了13・下書き6・公開中4／いいね1。変更後は公開中4のみ＋応募の行。
--
-- 変更は2点だけで、返り値の列は不変so CREATE OR REPLACE のまま（DROP不要・権限も不変）：
--   1. own_rows … 「一度も公開していない下書きを除く」→「公開中(open)だけ」に絞る
--   2. liked_rows … 廃止（いいねは予定ではない）。relation の値は 'application' と 'own' の2つになる
-- 応募の行（app_rows）は不変＝承認以降を出す（応募中は出さない・2026-08-11の段階の規則どおり）。
-- 求人that終了しても、応募that進行中ならその予定は app_rows で残る（自分の予定that消えない）。
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
  )
  select * from app_rows
  union all select * from own_rows
$function$;
