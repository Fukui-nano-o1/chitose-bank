-- 働き手ダッシュボード（#/admin/evaluation・2026-08-05たきと指示）。
-- 用途：農家が働き手を確認するときに一番見るページ。運営の見守り用ではない。
--   ① 直近5件に遅刻・欠勤はあるか ② 労働の総件数・総時間 ③ 作物別・作業別の件数と時間
--
-- 【当面は管理者ゲート】農家に見せるのはまだ早い。CLAUDE.md「求職者公開項目の制約」は
--   提示してよい項目を10個に限定し、稼働回数などの生の数値を絶対禁止に挙げている。
--   一方 worker_trust_info は「応募関係のある農家」にだけ完了件数・稼働時間を返す前例。
--   解禁するときは、下の app_admins ゲートを同じ関係ゲートに緩める1箇所の変更で足りる形にした。
--   それまでは app_admins のみ＝第三者への提示は発生しない（フロントの非表示だけに頼らない）。
--
-- 【数え方の規約】
--   ・労働時間は求人の勤務時間（jobs.work_time "H:MM〜H:MM"）から算出する。worker_trust_info と
--     同じ数え方＝サイト内に総時間が2種類現れない。休憩は差し引かない（既存の数え方に合わせる）。
--   ・件数・時間の母数は status='completed' かつ attended が false でないもの（欠勤は労働に数えない）。
--   ・遅刻は打刻（started_at）と求人の開始時刻の差。自動開始（cron が開始時刻ちょうどに打つ）は
--     本人の打刻ではないので遅刻判定しない＝「記録なし」に倒す。憶測で遅刻にしない。

-- 勤務時間の文字列から開始時刻を取り出す。取り出せなければ null（呼び出し側で「記録なし」に倒す）。
-- 正規表現で抜き出す＝「8:00〜17:00（休憩60分）」のような余分な文字が付いていても壊れない。
create or replace function public.job_scheduled_start(p_work_time text)
returns time
language sql
immutable
set search_path to 'public'
as $$
  select (regexp_match(coalesce(p_work_time,''), '(\d{1,2}:\d{2})〜(\d{1,2}:\d{2})'))[1]::time;
$$;

-- 勤務時間の文字列から予定の長さ（分）を出す。日をまたぐ書き方（終了 < 開始）は数えない＝null。
create or replace function public.job_scheduled_minutes(p_work_time text)
returns int
language sql
immutable
set search_path to 'public'
as $$
  select case
    when m is null then null
    when (m[2]::time - m[1]::time) <= interval '0' then null
    else (extract(epoch from (m[2]::time - m[1]::time)) / 60)::int
  end
  from (select regexp_match(coalesce(p_work_time,''), '(\d{1,2}:\d{2})〜(\d{1,2}:\d{2})') as m) s;
$$;

create or replace function public.admin_worker_dashboard(p_worker_id uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_workers json; v_worker json; v_recent json; v_by_crop json; v_by_task json;
  v_count int; v_absent int; v_minutes int; v_unknown int;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;

  -- 一覧（働き手を選ぶ画面）：完了のある働き手だけを、件数の多い順に
  if p_worker_id is null then
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
  end if;

  select json_build_object('worker_id', p_worker_id, 'name', wp.nickname)
    into v_worker
    from public.worker_profiles wp where wp.auth_id = p_worker_id;
  if v_worker is null then
    v_worker := json_build_object('worker_id', p_worker_id, 'name', null);
  end if;

  -- ② 総件数・総時間（欠勤は分けて数える。時間の分からない件は数だけ持つ）
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

  -- ① 直近5件（欠勤も含めて出す＝「遅刻欠勤があるか」を見るページなので隠さない）
  select coalesce(json_agg(row order by ord desc nulls last), '[]'::json) into v_recent
  from (
    select json_build_object(
             'application_id', a.id,
             'job_number', a.job_number,
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

  -- ③ 作物別・作業別（件数と時間）
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

revoke all on function public.admin_worker_dashboard(uuid) from public, anon;
grant execute on function public.admin_worker_dashboard(uuid) to authenticated;

-- 旧：admin_evaluation_records（マッチ1件＝カード1枚の運営見守り版）は、このダッシュボードに
-- 置き換わったので削除する。定義の全文は直前の migration
-- 20260805091432_admin_evaluation_records.sql に残っている（必要になったらそこから復元できる）。
drop function if exists public.admin_evaluation_records();
