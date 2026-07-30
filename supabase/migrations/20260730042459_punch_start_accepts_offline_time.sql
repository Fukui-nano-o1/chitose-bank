-- 圏外で押した打刻を、電波が戻ってから「押した時刻」で送れるようにする（第13弾(3)・2026-07-30たきと指示）
--
-- 既存は started_at = now() 固定なので、オフラインキューから送ると「復帰した時刻」で記録されてしまう。
-- 引数 p_at を足して、端末が保存した打刻時刻を渡せるようにする。
--
-- ★クライアント申告の時刻は偽装できる。勤怠は報酬に直結するため、サーバ側で必ずクランプする。
-- ★1引数版を残すと呼び出しがそちらに解決され、クランプを通らない経路が残るのでDROPする。
--
-- ※この版にはバグがあり、同日の 20260730042606 → 20260730042715 で修正している：
--   クランプ③（作業日より前は不可）を p_at の有無に関わらず適用していたため、
--   作業日が未来の求人では通常の打刻が作業開始日へ「繰り上げ」られていた（検収で発見）。
drop function if exists public.punch_start(uuid);

create or replace function public.punch_start(p_application_id uuid, p_at timestamptz default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_worker uuid; v_status text; v_started timestamptz; v_at timestamptz; v_day date;
begin
  select a.worker_id, a.status, a.started_at, j.date_start
    into v_worker, v_status, v_started, v_day
    from public.applications a join public.jobs j on j.job_number = a.job_number
   where a.id = p_application_id;
  if v_worker is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_worker <> auth.uid() then return json_build_object('ok', false, 'reason', 'not_yours'); end if;
  if v_status not in ('approved','meeting','interview','contracted','working') then
    return json_build_object('ok', false, 'reason', 'bad_status', 'status', v_status);
  end if;
  if v_started is not null then
    return json_build_object('ok', true, 'already', true, 'started_at', v_started);
  end if;

  v_at := coalesce(p_at, now());
  if v_at > now() then v_at := now(); end if;
  if v_at < now() - interval '24 hours' then v_at := now() - interval '24 hours'; end if;
  if v_day is not null and v_at < (v_day::timestamptz) then v_at := v_day::timestamptz; end if;

  update public.applications set started_at = v_at, status = 'working'
   where id = p_application_id;
  return json_build_object('ok', true, 'started_at', v_at, 'clamped', (p_at is not null and v_at <> p_at));
end;
$function$;
