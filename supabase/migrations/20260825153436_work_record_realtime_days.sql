-- はたらいた記録を日数ベース・リアルタイムに（2026-08-25たきと指示
-- 「件数は日数にしよう。直近5件はリアルタイムで計上可能か？もう4日も仕事に行っているが記録がない。
--   作物別と作業別もリアルタイムで」）。
-- 2026-08-21に総時間だけを日ごとの加算にしたが、件数・直近・作物別・作業別は completed のままだった
-- ＝進行中の仕事が「記録なし」に見えていた（本番：#1232が4日ぶん働いて12時間だけ出ていた状態）。
--
-- 数え方の唯一のソースを app_accrued_days（終わった作業日）に一本化する：
--   完了した仕事＝完了日（JST）までの作業日／進行中＝終了時刻（JST）を過ぎた作業日。
--   作業日そのものは app_work_dates（agreed_dates ＞ 求人の期間、休日を除く）＝
--   カレンダー・二重予約の壁と同じ物差し。ここで独自に日を作らない。
-- ★勤務時間が読めない求人（日またぎ含む）は、時間は unknown のまま（憶測で時間を作らない）だが、
--   日数には数える（その日に働いた事実は分かる）＝その日の終わり（23:59）を過ぎたら1日と数える。
--
-- ★この版で当てた worker_work_record は、集合を返す関数に別名を付け忘れていて実行時に落ちた
--   （column "d" does not exist）。正しい定義は次の 20260825153513 にある＝ここには置かない
--   （このファイルだけを流しても壊れた関数が残らないようにするため）。

-- ① 終わった作業日（この関数が日数・時間・内訳の共通の土台）
create or replace function public.app_accrued_days(p_app uuid)
 returns setof date
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with s as (
    select ap.id, ap.status,
           ((regexp_match(coalesce(j.work_time,''), '(\d{1,2}:\d{2})' || chr(12316) || '(\d{1,2}:\d{2})'))[2])::time as end_t,
           coalesce(ap.work_completed_at at time zone 'Asia/Tokyo', now() at time zone 'Asia/Tokyo')::date as done_d,
           now() at time zone 'Asia/Tokyo' as now_ts
      from public.applications ap
      join public.jobs j on j.job_number = ap.job_number
     where ap.id = p_app
  )
  select wd.d
    from s, public.app_work_dates(s.id) as wd(d)
   where case when s.status = 'completed'
              then wd.d <= s.done_d
              -- 勤務時間が読めない求人は、その日の終わり（23:59）を過ぎたら1日と数える
              else (wd.d + coalesce(s.end_t, time '23:59')) <= s.now_ts end;
$function$;

revoke all on function public.app_accrued_days(uuid) from public, anon, authenticated;

-- ② 時間も同じ土台から出す（日数 × 1日の勤務時間）＝時間と日数が食い違わない
create or replace function public.app_accrued_minutes(p_app uuid)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- Single source of "worked minutes" for one application (2026-08-21, day source unified 2026-08-25).
  --   minutes = job_scheduled_minutes(work_time) x app_accrued_days(app)
  --   work_time unparseable (incl. overnight) -> null = unknown (never invent hours)
  select case
    when public.job_scheduled_minutes(j.work_time) is null then null
    else (public.job_scheduled_minutes(j.work_time)
          * (select count(*)::int from public.app_accrued_days(ap.id)))::int
  end
    from public.applications ap
    join public.jobs j on j.job_number = ap.job_number
   where ap.id = p_app;
$function$;
