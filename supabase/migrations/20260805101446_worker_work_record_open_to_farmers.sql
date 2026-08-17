-- はたらいた記録を農家に開く（2026-08-05たきと指示「管理者専用は撤回する」）。
--
-- 【何が変わったか】admin_worker_dashboard（app_admins のみ）を2つに分ける：
--   ① worker_work_record(worker_id) … 1人ぶんの記録。関係ゲート＝本人・その働き手から応募を
--      受けた農家・運営だけ。worker_trust_info と同じ判定を使う（同じ相手に同じ範囲で開く）。
--   ② admin_worker_list()          … 働き手の一覧。運営のみ（求職者の名簿ので農家には開かない）。
--
-- 【たきと裁定の記録】CLAUDE.md「求職者公開項目の制約」は提示してよい項目を10個に限定し、
--   稼働回数などの生の数値を絶対禁止に挙げている。本件はその例外として、
--   ・相手を限定する（応募を受けた農家＝すでに当事者。不特定の農家・訪問者には出さない）
--   ・出すのは記録から導出した事実のみ（点数・順位・おすすめ度は作らない）
--   の2条件で開く。すでに worker_trust_info が完了件数・稼働時間を同じ相手に返している延長。
--
-- 【この関数が返さないもの】
--   ・求人No.（job_number）は、運営と本人にだけ返す。閲覧する農家には返さない
--     ＝「その働き手がどの農家の求人で働いたか」を、求人ページ経由で辿れないようにする。
--     農家の判断に要るのは日付・作物・作業・遅刻欠勤で、相手先の特定は要らない。
--   ・自由記述・評価コメントの類は一切返さない（この関数は打刻と出欠の記録だけ）。
--
-- 【入口の順序】auth.uid() is null を必ず先に弾く（2026-07-29の
--   worker_trust_info フェイルオープンと同じ穴を作らないため。NULL比較は偽にならない）。

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
    join public.jobs j on j.job_number = a.job_number
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
      join public.jobs j on j.job_number = a.job_number
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
      join public.jobs j on j.job_number = a.job_number
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
      join public.jobs j on j.job_number = a.job_number
     where a.worker_id = p_worker_id and a.status = 'completed'
       and a.attended is distinct from false
     group by 1
  ) t;

  return json_build_object('ok', true, 'worker', v_worker,
    'totals', json_build_object('completed_count', coalesce(v_count,0), 'absent_count', coalesce(v_absent,0),
                                'total_minutes', coalesce(v_minutes,0), 'unknown_time_count', coalesce(v_unknown,0)),
    'recent', v_recent, 'by_crop', v_by_crop, 'by_task', v_by_task);
end; $function$;

revoke all on function public.worker_work_record(uuid) from public, anon;
grant execute on function public.worker_work_record(uuid) to authenticated;

-- ② 働き手の一覧＝求職者の名簿ので運営のみ（農家には開かない）。
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
      join public.jobs j on j.job_number = a.job_number
      left join public.worker_profiles wp on wp.auth_id = a.worker_id
     where a.status = 'completed'
     group by a.worker_id
  ) t;
  return json_build_object('ok', true, 'workers', v_workers);
end; $function$;

revoke all on function public.admin_worker_list() from public, anon;
grant execute on function public.admin_worker_list() to authenticated;

-- 旧：admin_worker_dashboard は上の2つに分かれたので削除。定義の全文は直前の migration
-- 20260805093104_admin_worker_dashboard.sql に残っている（必要になったらそこから復元できる）。
drop function if exists public.admin_worker_dashboard(uuid);
