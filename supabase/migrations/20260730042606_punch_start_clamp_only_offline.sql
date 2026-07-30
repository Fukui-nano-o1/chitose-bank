-- 修正：クランプは「オフラインから送られた時刻」だけに適用する（2026-07-30・自己検収で発見）
--
-- 直前の版（20260730042459）は、p_at が無い通常の打刻にもクランプ③（作業日より前は不可）を掛けていた。
-- 作業日が未来の求人では now() < 作業日 となり、通常の打刻が作業開始日へ「繰り上げ」られていた
-- （検収で started_at = 2026-12-10 になるのを確認）。クランプは下限であって上限ではないため、
-- 未来方向へ動かしてはいけない。
--   ・p_at が無い（=その場で押した）… now() をそのまま使う。クランプしない
--   ・p_at がある（=圏外キューからの送信）… 上限 now()／下限 max(now()-24h, 作業日0:00)。
--     ただし下限が now() を超える場合（作業日が未来）は now() に丸める＝繰り上げは起こさない
--
-- ※この版もまだ「作業日0:00」をUTCで解釈していたため、20260730042715 でJSTに直している。
create or replace function public.punch_start(p_application_id uuid, p_at timestamptz default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_worker uuid; v_status text; v_started timestamptz;
  v_at timestamptz; v_day date; v_min timestamptz;
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

  if p_at is null then
    v_at := now();                       -- その場で押した打刻はサーバ時刻。クランプしない
  else
    v_at := p_at;
    if v_at > now() then v_at := now(); end if;          -- 上限：未来にはできない
    v_min := now() - interval '24 hours';               -- 下限：当日の打ち忘れ救済までが射程
    if v_day is not null and v_day::timestamptz > v_min then v_min := v_day::timestamptz; end if;
    if v_min > now() then v_min := now(); end if;       -- ★下限が未来なら繰り上げず now() に留める
    if v_at < v_min then v_at := v_min; end if;
  end if;

  update public.applications set started_at = v_at, status = 'working'
   where id = p_application_id;
  return json_build_object('ok', true, 'started_at', v_at, 'clamped', (p_at is not null and v_at <> p_at));
end;
$function$;
