-- 退会者の名前解決を「退会した利用者」に（2026-08-07・退会後の余波5パターンのX2that発見）
--
-- 【穴】退会でプロフィール（worker/employer_profiles）that消え、emailthat withdrawn+uuid@withdrawn.invalid に
-- 匿名化されるthat、名前解決の最終フォールバックthat「emailの先頭2文字」so、退会者that "wi" と表示されていた
-- （チャット相手名・カレンダー相手名・通知・チャットのアイコン頭文字）。本名漏洩ではないthat無意味で不親切。
-- 【修正】emailthat withdrawn+%@withdrawn.invalid のとき、名前は「退会した利用者」・頭文字は「－」を返す。
-- email先頭2文字を使う3関数を揃えて直す（wp_default_nicknameは新規登録用so対象外）。
-- 検証済み（ロールバック付き実弾）：退会前=従来の名前／退会後=「退会した利用者」・カレンダー相手名も同じ・頭文字「－」。

create or replace function public.resolve_actor_name(p_auth_id uuid)
returns text language sql security definer set search_path to 'public'
as $function$
  select coalesce(
    (select nullif(nickname,'') from public.worker_profiles where auth_id = p_auth_id),
    (select nullif(nickname,'') from public.employer_profiles where auth_id = p_auth_id),
    (select case when email like 'withdrawn+%@withdrawn.invalid' then '退会した利用者' else left(email, 2) end
       from auth.users where id = p_auth_id),
    '不明（' || right(p_auth_id::text, 6) || '）'
  );
$function$;

create or replace function public.my_chat_partner_initials()
returns json language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(json_object_agg(q.partner_id::text, q.initials), '{}'::json)
  from (
    select distinct p.partner_id,
           case when u.email like 'withdrawn+%@withdrawn.invalid' then '－'
                else upper(left(u.email, 2)) end as initials
    from (
      select distinct case when a.worker_id = auth.uid() then a.farmer_id else a.worker_id end as partner_id
      from public.applications a
      where a.worker_id = auth.uid() or a.farmer_id = auth.uid()
    ) p
    join auth.users u on u.id = p.partner_id
    where u.email is not null and length(btrim(u.email)) > 0
  ) q;
$function$;

create or replace function public.get_my_calendar_jobs()
returns table(job_number integer, crop text, task text, date_start date, date_end date, work_time text, town text, status text, application_id uuid, application_status text, partner_name text, photos jsonb, relation text, my_role text, agreed_dates jsonb, terms_confirmed_worker_at timestamp with time zone, terms_confirmed_farmer_at timestamp with time zone)
language sql security definer set search_path to 'public'
as $function$
  with app_rows as (
    select
      j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
      a.id as application_id, a.status as application_status,
      case when a.worker_id = auth.uid() then
        coalesce(
          (select nullif(ep.nickname,'') from public.employer_profiles ep where ep.auth_id = a.farmer_id),
          (select nullif(wp.nickname,'') from public.worker_profiles wp where wp.auth_id = a.farmer_id),
          (select case when u.email like 'withdrawn+%@withdrawn.invalid' then '退会した利用者' else left(u.email, 2) end
             from auth.users u where u.id = a.farmer_id),
          '不明（' || right(a.farmer_id::text, 6) || '）'
        )
      else
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
