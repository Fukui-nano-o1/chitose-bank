-- 作業の自動開始（2026-07-27たきと指示「開始時間になったら、自動開始」）
--
-- 背景：開始は働き手の「作業を開始する」打刻に頼っていたが、当日に押し忘れると
-- 仕事→完了報告→評価の流れが止まる。押させるのをやめ、開始時刻が来たら記録側で開始する。
--
-- 対象：採用済み（両者の確認が揃った応募）で、まだ開始していないもののうち、
--   ・働く日が「今日」（agreed_dates があればその中に今日、無ければ date_start〜date_end に今日）
--   ・かつ jobs.work_time の開始時刻（"8:00〜16:00" の左側）を過ぎている
--     時刻が読めない求人は、その日の 6:00（JST）を開始時刻とみなす
-- すべて日本時間で判定する（cronはUTCで回るため、明示的に Asia/Tokyo に直す）。
--
-- 記録の憲法（2026-07-25）：状態を書き換えるだけでなく「誰の操作か」を残す。
-- 手動の打刻と区別できるよう auto_started を立てる（完了の auto_completed と同じ作法）。
alter table public.applications add column if not exists auto_started boolean not null default false;

create or replace function public.auto_start_work()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_now timestamptz := now(); v_today date := (now() at time zone 'Asia/Tokyo')::date;
        r record; v_start_txt text; v_h int; v_m int; v_due timestamptz; v_n int := 0;
begin
  for r in
    select a.id, j.work_time
      from public.applications a
      join public.jobs j on j.job_number = a.job_number
     where a.started_at is null
       and a.terms_confirmed_worker_at is not null
       and a.terms_confirmed_farmer_at is not null
       and a.status in ('approved','meeting','interview','contracted')
       and (
         case when jsonb_typeof(a.agreed_dates) = 'array' and jsonb_array_length(a.agreed_dates) > 0
              then a.agreed_dates ? to_char(v_today, 'YYYY-MM-DD')
              else j.date_start is not null and v_today between j.date_start and coalesce(j.date_end, j.date_start)
         end
       )
  loop
    -- "8:00〜16:00" / "08:00-16:00" などから開始時刻を取り出す。読めなければ 6:00 とみなす
    v_start_txt := substring(coalesce(r.work_time, '') from '^\s*([0-9]{1,2}:[0-9]{2})');
    if v_start_txt is null then v_h := 6; v_m := 0;
    else v_h := split_part(v_start_txt, ':', 1)::int; v_m := split_part(v_start_txt, ':', 2)::int;
    end if;
    v_due := ((v_today::text || ' ' || lpad(v_h::text, 2, '0') || ':' || lpad(v_m::text, 2, '0'))::timestamp)
             at time zone 'Asia/Tokyo';
    if v_now >= v_due then
      update public.applications
         set started_at = v_due, status = 'working', auto_started = true
       where id = r.id and started_at is null;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$function$;

revoke all on function public.auto_start_work() from public, anon, authenticated;

-- 毎時0分（開始リマインダーと同じ刻み）。cron_watchdogの監視対象にも自然に乗る
select cron.schedule('auto-start-work', '5 * * * *', $$ select public.auto_start_work(); $$);
