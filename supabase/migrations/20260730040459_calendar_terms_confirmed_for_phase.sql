-- カレンダーに「誰がいつ来るか」を出すため、採用の判定に要る2列を返すようにする（2026-07-29たきと指示）
--
-- 経緯：段階（応募中/面接中/採用/作業中/完了）の唯一のソースは appPhaseKey(a) だが、
-- これは terms_confirmed_worker_at と terms_confirmed_farmer_at を見て「面接中」と「採用」を分ける。
-- get_my_calendar_jobs がこの2列を返していなかったため、カレンダーだけ静的マップ
-- （CALENDAR_STATUS_LABEL＝approvedを面接中で代表）という近似を使っていた。
-- 名前チップは「採用済み＝本当に来る人」だけを出すので、近似では足りない＝2列を返す。
-- ※実データで確認：採用済みでも applications.status は 'approved' のまま（contractedは書かれない）。
--   つまりこの2列が無いと採用と面接中を区別できない。
--
-- 返り値の列を増やすため DROP → CREATE（RETURNS TABLE の型が変わる）。
-- 権限は元と同じ（anon含むPUBLIC実行可）に戻ることを検収で確認。中身の可視範囲は変えていない：
-- 当事者のapplications（worker_id=auth.uid() or farmer_id=auth.uid()）＋自分の求人＋自分のいいねのみ。
drop function if exists public.get_my_calendar_jobs();

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
      public.resolve_actor_name(
        case when a.worker_id = auth.uid() then a.farmer_id else a.worker_id end
      ) as partner_name,
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
