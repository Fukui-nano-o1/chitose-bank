-- 修正：オフライン打刻の下限「作業日0:00」を日本時間で判定する（2026-07-30・自己検収で発見）
--
-- 直前の版（20260730042606）は v_day::timestamptz（date→timestamptzの暗黙変換）を使っており、
-- DBのタイムゾーン（UTC）で0:00と解釈されていた＝日本時間の09:00。
-- 早朝の作業（求人の時間帯に「早朝」が実在する）で7:00に押した打刻を圏外キューから送ると、
-- 09:00へ繰り上げられてしまう（検収で再現確認）。
-- 下限は日本時間の0:00にする。24時間の下限が主たる歯止めなので、こちらを緩めても悪用余地は増えない。
--
-- ▼ここが最終版。オフライン打刻のクランプ規則：
--   ・p_at なし … now() をそのまま記録（クランプしない）
--   ・p_at あり … 上限 now()／下限 max(now()-24時間, 作業日0:00 JST)。下限が未来なら now()
--   ・丸めた場合も黙って通す（エラーにしない）＝圏外の人を弾かない。
--     事実と違えば相手方が修正申請（request_time_correction）で直す＝二層の設計
create or replace function public.punch_start(p_application_id uuid, p_at timestamptz default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_worker uuid; v_status text; v_started timestamptz;
  v_at timestamptz; v_day date; v_min timestamptz; v_day_start timestamptz;
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
    v_min := now() - interval '24 hours';               -- 下限①：当日の打ち忘れ救済までが射程
    v_day_start := v_day::timestamp at time zone 'Asia/Tokyo';  -- 下限②：作業日の0:00（日本時間）
    if v_day is not null and v_day_start > v_min then v_min := v_day_start; end if;
    if v_min > now() then v_min := now(); end if;       -- 下限が未来なら繰り上げず now() に留める
    if v_at < v_min then v_at := v_min; end if;
  end if;

  update public.applications set started_at = v_at, status = 'working'
   where id = p_application_id;
  return json_build_object('ok', true, 'started_at', v_at, 'clamped', (p_at is not null and v_at <> p_at));
end;
$function$;
