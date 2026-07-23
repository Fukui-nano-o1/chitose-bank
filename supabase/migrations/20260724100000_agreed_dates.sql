-- 働く日の確定（2026-07-24 追記3）＝二頭運転の同期写経。
--   applications.agreed_dates（jsonb・農家が確定した働く日）と set_agreed_dates RPC は別端末が本番先行適用済み。
--   ここで repo に写経して同期する。get_my_calendar_jobs への agreed_dates 追加と my_nav_badges の
--   当日判定更新は本セッションで適用（下記）。冪等形so再適用も安全。

-- 1) 列（先行適用済み・冪等）
alter table public.applications add column if not exists agreed_dates jsonb;

-- 2) set_agreed_dates（先行適用済みの本番定義を写経）：農家が働く日を確定。期間内検証・M24通知・やり直し可（UPDATE）
create or replace function public.set_agreed_dates(p_application_id uuid, p_dates jsonb)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_farmer uuid; v_worker uuid; v_job int; v_status text;
        v_ds date; v_de date; v_bad int; v_list text;
begin
  select a.farmer_id, a.worker_id, a.job_number, a.status
    into v_farmer, v_worker, v_job, v_status
    from public.applications a where a.id = p_application_id;
  if v_farmer is null then return json_build_object('ok',false,'reason','not_found'); end if;
  if v_farmer <> auth.uid() then return json_build_object('ok',false,'reason','not_yours'); end if;
  if v_status not in ('approved','meeting','interview','contracted','working') then
    return json_build_object('ok',false,'reason','bad_status');
  end if;
  if p_dates is null or jsonb_typeof(p_dates) <> 'array'
     or jsonb_array_length(p_dates) = 0 then
    return json_build_object('ok',false,'reason','empty');
  end if;

  select j.date_start, coalesce(j.date_end, j.date_start) into v_ds, v_de
    from public.jobs j where j.job_number = v_job;
  select count(*) into v_bad from jsonb_array_elements_text(p_dates) d
   where d::date < v_ds or d::date > v_de;
  if v_bad > 0 then
    return json_build_object('ok',false,'reason','out_of_range',
      'message','求人の期間外の日が含まれています');
  end if;

  update public.applications set agreed_dates = p_dates where id = p_application_id;

  select string_agg(to_char(d::date,'MM/DD'), '・' order by d::date)
    into v_list from jsonb_array_elements_text(p_dates) d;

  insert into public.notifications (farmer_id, type, message)
  values (v_worker, 'dates_agreed',
          '求人 #' || v_job || '：働く日が決まりました（' || v_list || '）');
  begin
    perform public.send_user_email(v_worker,
      '[chitose-bank] 働く日が決まりました：求人 #' || v_job,
      '■ ' || public.job_ref(v_job,'worker') || E'\n\n' ||
      '■ 働く日：' || v_list || E'\n\n' ||
      '内容に相違がないか、確認カードでもう一度ご確認ください。' || E'\n' ||
      '日程の変更が必要になった時は、チャットで相談のうえ、' || E'\n' ||
      '当日の変更は緊急連絡（延期）をお使いください。' || E'\n\n' ||
      'https://chitose-bank.com/#/profile/worker/approved' || public.job_link(v_job));
  exception when others then null; end;
  return json_build_object('ok', true);
end; $function$;
grant execute on function public.set_agreed_dates(uuid, jsonb) to authenticated;

-- 3) get_my_calendar_jobs：agreed_dates を返す列を追加（本セッションで適用）
drop function if exists public.get_my_calendar_jobs();
create or replace function public.get_my_calendar_jobs()
 returns table(job_number integer, crop text, task text, date_start date, date_end date, work_time text, town text, status text, application_id uuid, application_status text, partner_name text, photos jsonb, relation text, my_role text, agreed_dates jsonb)
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
      a.agreed_dates
    from public.applications a
    join public.jobs j on j.job_number = a.job_number
    where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
      and a.status = any (array['approved','meeting','interview','contracted','working'])
  ),
  own_rows as (
    select
      j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
      null::uuid, null::text, null::text, j.photos,
      'own'::text, 'farmer'::text, null::jsonb
    from public.jobs j
    where j.farmer_id = auth.uid()
      and j.date_start is not null
      and not exists (select 1 from app_rows ar where ar.job_number = j.job_number)
  ),
  liked_rows as (
    select
      j.job_number, j.crop, j.task, j.date_start, j.date_end, j.work_time, j.town, j.status,
      null::uuid, null::text, null::text, j.photos,
      'liked'::text, 'worker'::text, null::jsonb
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
grant execute on function public.get_my_calendar_jobs() to authenticated;

-- 4) my_nav_badges：calendar_today＝agreed_dates があれば当日∈agreed_dates、無ければ従来の期間判定（本セッションで適用）
create or replace function public.my_nav_badges()
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select json_build_object(
    'chat_threads', (
      select count(distinct m.application_id)
        from public.messages m join public.applications a on a.id = m.application_id
       where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
         and a.status in ('applied','approved','meeting','interview','contracted','working','completed','rejected')
         and m.sender_id <> auth.uid() and m.read_at is null
    ) + (case when exists (
        select 1 from public.admin_messages am
        where am.user_id = auth.uid() and am.from_admin and am.read_at is null
      ) then 1 else 0 end),
    'calendar_today', (
      select count(*) from public.applications a join public.jobs j on j.job_number = a.job_number
      where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
        and a.terms_snapshot is not null
        and j.date_start is not null
        and case
          when a.agreed_dates is not null and jsonb_typeof(a.agreed_dates) = 'array' and jsonb_array_length(a.agreed_dates) > 0
            then exists (select 1 from jsonb_array_elements_text(a.agreed_dates) d where d::date = (now() at time zone 'Asia/Tokyo')::date)
          else (now() at time zone 'Asia/Tokyo')::date >= j.date_start
               and (now() at time zone 'Asia/Tokyo')::date <= coalesce(j.date_end, j.date_start)
        end
    ),
    'review_due', (
      select count(*) from public.applications a
      where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
        and a.status = 'completed'
        and a.work_completed_at is not null
        and a.work_completed_at >= now() - interval '3 days'
        and not exists (select 1 from public.reviews r where r.application_id = a.id and r.reviewer_id = auth.uid())
    ),
    'job_revision', (
      select count(*) from public.jobs j
      where j.farmer_id = auth.uid() and j.status = 'draft' and j.revision_requested_at is not null
    )
  );
$function$;
