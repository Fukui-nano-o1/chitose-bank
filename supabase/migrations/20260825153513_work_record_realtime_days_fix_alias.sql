-- 直前の 20260825153436 の修正：集合を返す関数の列に別名を付けていなかった（column "d" does not exist）。
-- ★setof を from に置いて列名で参照する時は必ず as wd(d) を付ける。
-- はたらいた記録：日数・直近・作物別・作業別を、進行中の仕事も含めて数える（2026-08-25たきと指示）。
create or replace function public.worker_work_record(p_worker_id uuid)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_worker json; v_recent json; v_by_crop json; v_by_task json;
  v_days int; v_absent int; v_minutes int; v_unknown int;
  v_admin boolean; v_self boolean; v_detail boolean;
begin
  if auth.uid() is null or p_worker_id is null then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;
  v_admin := exists (select 1 from public.app_admins a where a.auth_id = auth.uid());
  v_self  := (auth.uid() = p_worker_id);
  if not v_admin and not v_self and not exists (
    select 1 from public.applications a
    where a.worker_id = p_worker_id and a.farmer_id = auth.uid()
  ) then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;
  v_detail := (v_admin or v_self);

  select json_build_object('worker_id', p_worker_id, 'name', wp.nickname)
    into v_worker
    from public.worker_profiles wp where wp.auth_id = p_worker_id;
  if v_worker is null then
    v_worker := json_build_object('worker_id', p_worker_id, 'name', null);
  end if;

  -- 働いた日数・時間（進行中も終わった作業日ぶんだけ数える）
  select coalesce(sum((select count(*) from public.app_accrued_days(a.id) as wd(d))), 0)::int,
         coalesce(sum(public.app_accrued_minutes(a.id)), 0)::int,
         coalesce(sum(case when public.job_scheduled_minutes(j.work_time) is null
                           then (select count(*) from public.app_accrued_days(a.id) as wd(d)) else 0 end), 0)::int
    into v_days, v_minutes, v_unknown
    from public.applications a
    join public.jobs j on j.job_number = a.job_number
   where a.worker_id = p_worker_id and a.status in ('working','completed')
     and a.attended is distinct from false;

  -- 欠勤は仕事の単位で数える（来なかった回＝applications.attended = false）
  select count(*) into v_absent
    from public.applications a
   where a.worker_id = p_worker_id and a.status = 'completed' and a.attended is false;

  -- 直近の仕事5件（進行中も含む。日付は最後に働いた作業日）
  select coalesce(json_agg(row order by ord desc nulls last), '[]'::json) into v_recent
  from (
    select json_build_object(
             'application_id', a.id,
             'job_number', case when v_detail then a.job_number end,
             'crop', case when v_detail then j.crop end,
             'task', case when v_detail then j.task end,
             'work_date', to_char(coalesce(
                            (select max(wd.d) from public.app_accrued_days(a.id) as wd(d)),
                            (a.work_completed_at at time zone 'Asia/Tokyo')::date,
                            j.date_start), 'YYYY/MM/DD'),
             'days', (select count(*) from public.app_accrued_days(a.id) as wd(d)),
             'attended', a.attended,
             'minutes', public.app_accrued_minutes(a.id)
           ) as row,
           coalesce((select max(wd.d) from public.app_accrued_days(a.id) as wd(d)),
                    (a.work_completed_at at time zone 'Asia/Tokyo')::date,
                    j.date_start) as ord
      from public.applications a
      left join public.jobs j on j.job_number = a.job_number
     where a.worker_id = p_worker_id
       and (a.status = 'completed'
            or (a.status = 'working' and exists (select 1 from public.app_accrued_days(a.id) as wd(d))))
     order by ord desc nulls last
     limit 5
  ) t;

  -- 作物別・作業別：件数ではなく【日数】。進行中の仕事も終わった作業日ぶんだけ数える
  select coalesce(json_agg(json_build_object('key', key, 'count', cnt, 'minutes', mins)
                  order by cnt desc, key asc), '[]'::json) into v_by_crop
  from (
    select coalesce(j.crop, '未設定') as key,
           coalesce(sum((select count(*) from public.app_accrued_days(a.id) as wd(d))), 0)::int as cnt,
           coalesce(sum(public.app_accrued_minutes(a.id)), 0)::int as mins
      from public.applications a
      left join public.jobs j on j.job_number = a.job_number
     where a.worker_id = p_worker_id and a.status in ('working','completed')
       and a.attended is distinct from false
     group by 1
    having coalesce(sum((select count(*) from public.app_accrued_days(a.id) as wd(d))), 0) > 0
  ) t;

  select coalesce(json_agg(json_build_object('key', key, 'count', cnt, 'minutes', mins)
                  order by cnt desc, key asc), '[]'::json) into v_by_task
  from (
    select coalesce(j.task, '未設定') as key,
           coalesce(sum((select count(*) from public.app_accrued_days(a.id) as wd(d))), 0)::int as cnt,
           coalesce(sum(public.app_accrued_minutes(a.id)), 0)::int as mins
      from public.applications a
      left join public.jobs j on j.job_number = a.job_number
     where a.worker_id = p_worker_id and a.status in ('working','completed')
       and a.attended is distinct from false
     group by 1
    having coalesce(sum((select count(*) from public.app_accrued_days(a.id) as wd(d))), 0) > 0
  ) t;

  return json_build_object('ok', true, 'worker', v_worker,
    'totals', json_build_object('worked_days', coalesce(v_days,0), 'absent_count', coalesce(v_absent,0),
                                'total_minutes', coalesce(v_minutes,0), 'unknown_time_days', coalesce(v_unknown,0)),
    'profile_view_count', case when v_detail then
      coalesce((select c.view_count from public.worker_profile_view_counts c where c.worker_id = p_worker_id), 0)
    end,
    'recent', v_recent, 'by_crop', v_by_crop, 'by_task', v_by_task);
end; $function$;
