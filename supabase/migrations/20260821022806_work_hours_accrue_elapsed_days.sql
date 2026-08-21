-- 作業時間を「終わった実働日ぶん」でリアルタイムに積み上げる（2026-08-21たきと指示
-- 「作業時間はリアルタイムで更新できない？」→提案承認「いいね」）。
--
-- 【何が問題だったか（実測）】
--  1. total_hours / total_minutes は status='completed' の応募だけを数えていた＝複数日の仕事の
--     途中（working）は何日働いても 0時間 のまま（例：#1232 ネギ収穫・3日目終了時点で 0時間）。
--  2. さらに完了しても 1応募 = job_scheduled_minutes（1日ぶん）×1回 しか足していなかった＝
--     5日働く求人でも完了時に1日ぶんしか計上されない過少計上バグ。
--
-- 【新しい数え方＝唯一のソース app_accrued_minutes(応募id)】
--   分数 = 1日の勤務時間（job_scheduled_minutes）×「終わった実働日」の数
--   実働日 = app_work_dates(応募)（agreed_dates優先・無ければ求人範囲・holidays除外＝
--            カレンダー・二重予約の壁と同じ唯一のソース）
--   working   ＝ その日の終了時刻（JST）を過ぎた実働日を数える → 日ごとに自動で積み上がる
--   completed ＝ 完了日（work_completed_at のJST日付）までの実働日を数える → 完了時点で凍結
--     ※日付単位の比較にする理由：農家が終了時刻の数分前に完了を記録した実例があり
--       （8/16・end 17:30 に対し完了 17:13）、時刻比較だとその日が消える（実データで検出した退行）。
--   勤務時間が読めない求人（日またぎ含む）＝ null＝unknown（憶測で時間を作らない・従来どおり）
--
-- 【変える範囲＝時間だけ。件数・欠勤・作物別の件数は完了ベースのまま不変】
--   worker_trust_info / worker_trust_info_bulk / my_worker_trust_stats / worker_work_record /
--   admin_worker_list の5関数（時間の定義はサイト内に1つ・2026-08-05規則）。
--   worker_work_record の by_crop/by_task は完了のみ（進行中ぶんは総時間だけに乗る＝画面の注記で説明）。
--   trg_job_publish_snapshot の job_scheduled_minutes 利用は最賃換算＝別用途なので触らない。
--
-- 【適用の作法】関数本文に日本語リテラル（'未設定' 等）があるため書き写さず、
--   pg_get_functiondef の現物に ASCII アンカーで replace を掛けて execute する（2026-08-16の教訓）。
--   置換件数を毎回検査し、想定外なら raise exception＝トランザクションごと巻き戻る。冪等
--   （既に app_accrued_minutes を含む関数はスキップ）。
--
-- 【検証（本番・実ロール実測）】たきと（#1232・6:00〜9:00×実働5日・3日目終了時点）＝
--   0時間→9時間（total_minutes 540）・completed_count 0のまま／完了済みの2人（キリト420分・
--   たっきー120分）＝1件も変化なし／farmer視点・bulk・admin_worker_list も同値／
--   helper は anon/authenticated から EXECUTE 不可。

create or replace function public.app_accrued_minutes(p_app uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $fn$
  -- Single source of "worked minutes" for one application (2026-08-21).
  --   minutes   = job_scheduled_minutes(work_time) x finished work days
  --   work days = app_work_dates(app)  (agreed_dates > job range, holidays excluded)
  --   completed: days up to the completion date (JST) -> frozen at completion
  --   working  : days whose end time (JST) has passed -> grows day by day
  --   work_time unparseable (incl. overnight) -> null = unknown (never invent hours)
  -- Backend-only helper like app_work_dates: revoked from clients (audit 3c type).
  with s as (
    select ap.id, ap.status,
           public.job_scheduled_minutes(j.work_time) as m,
           ((regexp_match(coalesce(j.work_time,''), '(\d{1,2}:\d{2})' || chr(12316) || '(\d{1,2}:\d{2})'))[2])::time as end_t,
           coalesce(ap.work_completed_at at time zone 'Asia/Tokyo', now() at time zone 'Asia/Tokyo')::date as done_d,
           now() at time zone 'Asia/Tokyo' as now_ts
      from public.applications ap
      join public.jobs j on j.job_number = ap.job_number
     where ap.id = p_app
  )
  select case
    when s.m is null then null
    else (s.m * (select count(*)::int
                   from public.app_work_dates(s.id) as wd(d)
                  where case when s.status = 'completed'
                             then wd.d <= s.done_d
                             else (wd.d + s.end_t) <= s.now_ts end))::int
  end
  from s;
$fn$;

revoke all on function public.app_accrued_minutes(uuid) from public;
revoke all on function public.app_accrued_minutes(uuid) from anon, authenticated;

do $patch$
declare
  src text; o text; nw text; n int;
begin
  -- ============ 1) worker_trust_info(uuid) ============
  src := pg_get_functiondef('public.worker_trust_info(uuid)'::regprocedure);
  if position('app_accrued_minutes' in src) = 0 then
    o := $q$(coalesce(sum(public.job_scheduled_minutes(j.work_time)), 0) / 60)::int$q$;
    nw := $q$(coalesce(sum(public.app_accrued_minutes(a.id)), 0) / 60)::int$q$;
    n := (length(src) - length(replace(src, o, ''))) / length(o);
    if n <> 1 then raise exception 'worker_trust_info R1: % hits', n; end if;
    src := replace(src, o, nw);

    o := $q$and a.status = 'completed' and a.attended is distinct from false;$q$;
    nw := $q$and a.status in ('working','completed') and a.attended is distinct from false;$q$;
    n := (length(src) - length(replace(src, o, ''))) / length(o);
    if n <> 1 then raise exception 'worker_trust_info R2: % hits', n; end if;
    src := replace(src, o, nw);

    -- replace the stale Japanese comment line (anchored by its ASCII part; never retype Japanese here)
    if position('end<=start' in src) = 0 then raise exception 'worker_trust_info R3: comment anchor missing'; end if;
    src := regexp_replace(src, '\n  -- [^\n]*end<=start[^\n]*\n',
      E'\n  -- hours = app_accrued_minutes: per-day scheduled minutes x finished work days (2026-08-21).\n  -- working accrues day by day / completed is frozen at its completion date. same rule as worker_work_record\n');
    if position('end<=start' in src) > 0 then raise exception 'worker_trust_info R3: comment not replaced'; end if;
    execute src;
  end if;

  -- ============ 2) my_worker_trust_stats() ============
  src := pg_get_functiondef('public.my_worker_trust_stats()'::regprocedure);
  if position('app_accrued_minutes' in src) = 0 then
    o := $q$(coalesce(sum(public.job_scheduled_minutes(j.work_time)), 0) / 60)::int$q$;
    nw := $q$(coalesce(sum(public.app_accrued_minutes(a.id)), 0) / 60)::int$q$;
    n := (length(src) - length(replace(src, o, ''))) / length(o);
    if n <> 1 then raise exception 'my_worker_trust_stats R1: % hits', n; end if;
    src := replace(src, o, nw);

    o := $q$and a.status = 'completed' and a.attended is distinct from false;$q$;
    nw := $q$and a.status in ('working','completed') and a.attended is distinct from false;$q$;
    n := (length(src) - length(replace(src, o, ''))) / length(o);
    if n <> 1 then raise exception 'my_worker_trust_stats R2: % hits', n; end if;
    src := replace(src, o, nw);
    execute src;
  end if;

  -- ============ 3) worker_trust_info_bulk(uuid[]) ============
  src := pg_get_functiondef('public.worker_trust_info_bulk(uuid[])'::regprocedure);
  if position('app_accrued_minutes' in src) = 0 then
    o := $q$count(*)::int as completed_count,$q$;
    nw := $q$(count(*) filter (where a.status = 'completed'))::int as completed_count,$q$;
    n := (length(src) - length(replace(src, o, ''))) / length(o);
    if n <> 1 then raise exception 'bulk B1: % hits', n; end if;
    src := replace(src, o, nw);

    o := $q$(coalesce(sum(public.job_scheduled_minutes(j.work_time)), 0) / 60)::int as total_hours$q$;
    nw := $q$(coalesce(sum(public.app_accrued_minutes(a.id)), 0) / 60)::int as total_hours$q$;
    n := (length(src) - length(replace(src, o, ''))) / length(o);
    if n <> 1 then raise exception 'bulk B2: % hits', n; end if;
    src := replace(src, o, nw);

    o := $q$where a.status = 'completed' and a.attended is distinct from false$q$;
    nw := $q$where a.status in ('working','completed') and a.attended is distinct from false$q$;
    n := (length(src) - length(replace(src, o, ''))) / length(o);
    if n <> 1 then raise exception 'bulk B3: % hits', n; end if;
    src := replace(src, o, nw);

    -- jobs join is no longer read here (the helper joins jobs itself)
    o := E'\n      left join public.jobs j on j.job_number = a.job_number';
    n := (length(src) - length(replace(src, o, ''))) / length(o);
    if n <> 1 then raise exception 'bulk B4: % hits', n; end if;
    src := replace(src, o, '');
    execute src;
  end if;

  -- ============ 4) worker_work_record(uuid) ============
  src := pg_get_functiondef('public.worker_work_record(uuid)'::regprocedure);
  if position('app_accrued_minutes' in src) = 0 then
    o := $q$  select count(*) filter (where a.attended is distinct from false),
         count(*) filter (where a.attended is false),
         coalesce(sum(public.job_scheduled_minutes(j.work_time))
                  filter (where a.attended is distinct from false), 0)::int,
         count(*) filter (where a.attended is distinct from false
                            and public.job_scheduled_minutes(j.work_time) is null)
    into v_count, v_absent, v_minutes, v_unknown
    from public.applications a
    left join public.jobs j on j.job_number = a.job_number
   where a.worker_id = p_worker_id and a.status = 'completed';$q$;
    nw := $q$  select count(*) filter (where a.attended is distinct from false),
         count(*) filter (where a.attended is false),
         count(*) filter (where a.attended is distinct from false
                            and public.job_scheduled_minutes(j.work_time) is null)
    into v_count, v_absent, v_unknown
    from public.applications a
    left join public.jobs j on j.job_number = a.job_number
   where a.worker_id = p_worker_id and a.status = 'completed';

  -- total time accrues day by day (working + completed). counts above stay completed-only (2026-08-21)
  select coalesce(sum(public.app_accrued_minutes(a.id)), 0)::int
    into v_minutes
    from public.applications a
   where a.worker_id = p_worker_id and a.status in ('working','completed')
     and a.attended is distinct from false;$q$;
    n := (length(src) - length(replace(src, o, ''))) / length(o);
    if n <> 1 then raise exception 'work_record W1: % hits', n; end if;
    src := replace(src, o, nw);

    o := $q$'minutes', public.job_scheduled_minutes(j.work_time)$q$;
    nw := $q$'minutes', public.app_accrued_minutes(a.id)$q$;
    n := (length(src) - length(replace(src, o, ''))) / length(o);
    if n <> 1 then raise exception 'work_record W2: % hits', n; end if;
    src := replace(src, o, nw);

    o := $q$coalesce(sum(public.job_scheduled_minutes(j.work_time)), 0)::int as mins$q$;
    nw := $q$coalesce(sum(public.app_accrued_minutes(a.id)), 0)::int as mins$q$;
    n := (length(src) - length(replace(src, o, ''))) / length(o);
    if n <> 2 then raise exception 'work_record W3: % hits', n; end if;
    src := replace(src, o, nw);
    execute src;
  end if;

  -- ============ 5) admin_worker_list() ============
  src := pg_get_functiondef('public.admin_worker_list()'::regprocedure);
  if position('app_accrued_minutes' in src) = 0 then
    -- A4 first: after A1/A2 the inserted filters would also contain "where a.status = 'completed'",
    -- so anchor the outer where-clause together with the following group-by line (unique 2-line form)
    o := $q$where a.status = 'completed'
     group by a.worker_id$q$;
    nw := $q$where a.status in ('working','completed')
     group by a.worker_id$q$;
    n := (length(src) - length(replace(src, o, ''))) / length(o);
    if n <> 1 then raise exception 'admin_list A4: % hits', n; end if;
    src := replace(src, o, nw);

    o := $q$count(*) filter (where a.attended is distinct from false) as completed_count,$q$;
    nw := $q$count(*) filter (where a.status = 'completed' and a.attended is distinct from false) as completed_count,$q$;
    n := (length(src) - length(replace(src, o, ''))) / length(o);
    if n <> 1 then raise exception 'admin_list A1: % hits', n; end if;
    src := replace(src, o, nw);

    o := $q$count(*) filter (where a.attended is false) as absent_count,$q$;
    nw := $q$count(*) filter (where a.status = 'completed' and a.attended is false) as absent_count,$q$;
    n := (length(src) - length(replace(src, o, ''))) / length(o);
    if n <> 1 then raise exception 'admin_list A2: % hits', n; end if;
    src := replace(src, o, nw);

    o := $q$coalesce(sum(public.job_scheduled_minutes(j.work_time))
                    filter (where a.attended is distinct from false), 0)::int as total_minutes$q$;
    nw := $q$coalesce(sum(public.app_accrued_minutes(a.id))
                    filter (where a.attended is distinct from false), 0)::int as total_minutes$q$;
    n := (length(src) - length(replace(src, o, ''))) / length(o);
    if n <> 1 then raise exception 'admin_list A3: % hits', n; end if;
    src := replace(src, o, nw);
    execute src;
  end if;
end;
$patch$;
