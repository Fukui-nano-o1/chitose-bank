-- はたらいた記録は、求人の行が無くても消えない（2026-08-05たきと指示
-- 「過去の記録は絶対に消してはいけない」）。
--
-- 【はっきりさせること】closed（掲載終了）では何も消えない。求人の行は jobs に残り続け、
--   記録もそのまま出る。消えるのは行そのものを DELETE した時だけ（#1036 がこれだった）。
--   削除は trg_block_delete_past_job（2026-08-05）で既に止めてあるが、
--   「記録が求人の行の有無に左右される」構造自体を残さない＝内部結合を外部結合にする。
--
-- 【外部結合にすると何が変わるか】求人の行が無い回も、記録として数え・並ぶ：
--   ・働いた回数／欠勤 … 数える（応募の記録だけで確定するため）
--   ・働いた時間     … 求人の勤務時間が分からないので加算しない＝unknown_time_count に計上し、
--                      画面に「うちN件は勤務時間の記録がなく、時間に含めていません」と出る
--   ・作物別・作業別 … 「未設定」の行として出る（ダミーを入れない・憲法3条）
--   ・直近5件       … 日付は完了時刻・打刻から出す（求人の日程に頼らない）。
--                      遅刻判定は開始予定時刻が無いので「記録なし」に倒す（従来どおり）
--   ＝どの数字も、求人の行があるうちは今までと1件も変わらない（挙動は加算のみ）。
--
-- 対象は worker_work_record（1人ぶんの記録）と admin_worker_list（働き手の一覧）の2本。

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
  v_detail := (v_admin or v_self); -- 求人No.を返してよい相手

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
    left join public.jobs j on j.job_number = a.job_number   -- ★求人が無くても記録は残す
   where a.worker_id = p_worker_id and a.status = 'completed';

  select coalesce(json_agg(row order by ord desc nulls last), '[]'::json) into v_recent
  from (
    select json_build_object(
             'application_id', a.id,
             'job_number', case when v_detail then a.job_number end,
             'crop', j.crop,
             'task', j.task,
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
      left join public.jobs j on j.job_number = a.job_number  -- ★同上
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
      left join public.jobs j on j.job_number = a.job_number  -- ★同上
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
      left join public.jobs j on j.job_number = a.job_number  -- ★同上
     where a.worker_id = p_worker_id and a.status = 'completed'
       and a.attended is distinct from false
     group by 1
  ) t;

  return json_build_object('ok', true, 'worker', v_worker,
    'totals', json_build_object('completed_count', coalesce(v_count,0), 'absent_count', coalesce(v_absent,0),
                                'total_minutes', coalesce(v_minutes,0), 'unknown_time_count', coalesce(v_unknown,0)),
    'recent', v_recent, 'by_crop', v_by_crop, 'by_task', v_by_task);
end; $function$;

create or replace function public.admin_worker_list()
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_workers json;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;

  select coalesce(json_agg(json_build_object(
           'worker_id', t.worker_id,
           'name', t.name,
           'completed_count', t.completed_count,
           'absent_count', t.absent_count,
           'total_minutes', t.total_minutes)
         order by t.completed_count desc, t.name asc), '[]'::json)
    into v_workers
  from (
    select a.worker_id,
           max(wp.nickname) as name,
           count(*) filter (where a.attended is distinct from false) as completed_count,
           count(*) filter (where a.attended is false) as absent_count,
           coalesce(sum(public.job_scheduled_minutes(j.work_time))
                    filter (where a.attended is distinct from false), 0)::int as total_minutes
      from public.applications a
      left join public.jobs j on j.job_number = a.job_number   -- ★求人が無くても記録は残す
      left join public.worker_profiles wp on wp.auth_id = a.worker_id
     where a.status = 'completed'
     group by a.worker_id
  ) t;
  return json_build_object('ok', true, 'workers', v_workers);
end; $function$;
