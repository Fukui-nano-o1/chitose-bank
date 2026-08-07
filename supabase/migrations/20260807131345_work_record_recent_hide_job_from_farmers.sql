-- 直近5件から「過去の求人」を閲覧農家に出さない（2026-08-07たきと指示）。
-- 2026-08-05裁定は求人No.だけを伏せたが、作物×作業×日付が行単位で残ると結局どの求人か辿れる
-- （モザイクの原則：隠した情報を導ける別の項目も同時に塞ぐ・2026-08-03）。
-- 変更＝recent の crop / task も v_detail（運営・本人のみ）ゲートに載せる。2行のみ。
-- 残すもの＝日付・予定/打刻時刻・判定（裁定の「①直近5件の遅刻・欠勤」の本体）。
-- ③作物別・作業別の集計は裁定で開いた中身なので不変（日付と結合していない集計）。
-- 実測（JWT切替で検証済み）：農家＝recent全行で job_number/crop/task が null・日付/予定は維持／
-- 本人＝crop・No.とも従来どおり返る。
create or replace function public.worker_work_record(p_worker_id uuid)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_worker json; v_recent json; v_by_crop json; v_by_task json;
  v_count int; v_absent int; v_minutes int; v_unknown int;
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

  select count(*) filter (where a.attended is distinct from false),
         count(*) filter (where a.attended is false),
         coalesce(sum(public.job_scheduled_minutes(j.work_time))
                  filter (where a.attended is distinct from false), 0)::int,
         count(*) filter (where a.attended is distinct from false
                            and public.job_scheduled_minutes(j.work_time) is null)
    into v_count, v_absent, v_minutes, v_unknown
    from public.applications a
    left join public.jobs j on j.job_number = a.job_number
   where a.worker_id = p_worker_id and a.status = 'completed';

  select coalesce(json_agg(row order by ord desc nulls last), '[]'::json) into v_recent
  from (
    select json_build_object(
             'application_id', a.id,
             'job_number', case when v_detail then a.job_number end,
             'crop', case when v_detail then j.crop end,
             'task', case when v_detail then j.task end,
             'work_date', to_char(coalesce(a.work_completed_at at time zone 'Asia/Tokyo',
                                           a.started_at at time zone 'Asia/Tokyo',
                                           j.date_start::timestamp), 'YYYY/MM/DD'),
             'scheduled_start', to_char(public.job_scheduled_start(j.work_time), 'HH24:MI'),
             'actual_start', to_char(a.started_at at time zone 'Asia/Tokyo', 'HH24:MI'),
             'attended', a.attended,
             'auto_started', a.auto_started,
             'started_declared', a.started_declared,
             'time_corrected', a.time_corrected,
             'late_minutes', case
               when a.attended is false then null
               when a.started_at is null or public.job_scheduled_start(j.work_time) is null then null
               when coalesce(a.auto_started, false) then null
               else floor(extract(epoch from ((a.started_at at time zone 'Asia/Tokyo')::time
                                              - public.job_scheduled_start(j.work_time))) / 60)::int
             end,
             'minutes', public.job_scheduled_minutes(j.work_time)
           ) as row,
           coalesce(a.work_completed_at, a.started_at, j.date_start::timestamptz) as ord
      from public.applications a
      left join public.jobs j on j.job_number = a.job_number
     where a.worker_id = p_worker_id and a.status = 'completed'
     order by ord desc nulls last
     limit 5
  ) t;

  select coalesce(json_agg(json_build_object('key', key, 'count', cnt, 'minutes', mins)
                  order by cnt desc, key asc), '[]'::json) into v_by_crop
  from (
    select coalesce(j.crop, '未設定') as key, count(*) as cnt,
           coalesce(sum(public.job_scheduled_minutes(j.work_time)), 0)::int as mins
      from public.applications a
      left join public.jobs j on j.job_number = a.job_number
     where a.worker_id = p_worker_id and a.status = 'completed'
       and a.attended is distinct from false
     group by 1
  ) t;

  select coalesce(json_agg(json_build_object('key', key, 'count', cnt, 'minutes', mins)
                  order by cnt desc, key asc), '[]'::json) into v_by_task
  from (
    select coalesce(j.task, '未設定') as key, count(*) as cnt,
           coalesce(sum(public.job_scheduled_minutes(j.work_time)), 0)::int as mins
      from public.applications a
      left join public.jobs j on j.job_number = a.job_number
     where a.worker_id = p_worker_id and a.status = 'completed'
       and a.attended is distinct from false
     group by 1
  ) t;

  return json_build_object('ok', true, 'worker', v_worker,
    'totals', json_build_object('completed_count', coalesce(v_count,0), 'absent_count', coalesce(v_absent,0),
                                'total_minutes', coalesce(v_minutes,0), 'unknown_time_count', coalesce(v_unknown,0)),
    'recent', v_recent, 'by_crop', v_by_crop, 'by_task', v_by_task);
end; $function$;
