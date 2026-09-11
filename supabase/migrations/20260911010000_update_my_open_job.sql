-- 応募者がいない公開中の求人を、一時非公開にせず【掲載したまま】編集できるようにする（2026-09-11）。
-- 【従来】公開中(open)の求人は RLS「jobs owner update draft」が draft/pending しか許さないため、
--   編集は「一時非公開(unpublish_job)→編集→再掲載」の1本道だった＝編集の間はさがすから消える。
-- 【新設 update_my_open_job(p_job_number, p_patch)】本人・公開中・進行中の応募なし（move_job_dates と同じ物差し）の
--   3つの壁を通った時だけ、許可した列（p_patch のキー）だけを更新する。RLS は広げない（SECURITY DEFINER の1窓口）。
--   ★status・farmer_id・opened_at・凍結列（recruiter_*・pay_*・insurance_snapshot・profile_snapshot_at）・draft_step は
--     受け付けない（許可リスト外のキーは bad_field で拒否）。
-- 【掲載時の検査と凍結を open→open の編集でも走らせる】trg_job_publish_snapshot は draft→pending/open の遷移でしか
--   発火しないので、そのままだと編集で最賃割れ・時間外の未入力・受動喫煙の未設定が素通りする。
--   この窓口だけが立てるセッション変数 cb.edit_open='1' を見て、open→open でも同じ検査と凍結
--   （募集主3項目・待遇・保険・支払条件＝「再掲載」と同じ扱い）を走らせる＝壁は1本のまま。
--   関数の本文は写経しない：現物の条件行（ASCIIのアンカー1箇所）だけを置換して作り直す（置換件数を検査）。

do $$
declare
  src text;
  old_cond text := 'if new.status in (''pending'',''open'') and (tg_op = ''INSERT'' or coalesce(old.status,''draft'') = ''draft'') then';
  new_cond text := 'if new.status in (''pending'',''open'') and (tg_op = ''INSERT'' or coalesce(old.status,''draft'') = ''draft'' or (tg_op = ''UPDATE'' and old.status = ''open'' and coalesce(current_setting(''cb.edit_open'', true), '''') = ''1'')) then';
  n int;
begin
  src := pg_get_functiondef('public.trg_job_publish_snapshot'::regproc);
  n := (length(src) - length(replace(src, old_cond, ''))) / length(old_cond);
  if n <> 1 then
    if position(new_cond in src) > 0 then
      raise notice 'trg_job_publish_snapshot: already patched';
      return;
    end if;
    raise exception 'trg_job_publish_snapshot: anchor count % (expected 1)', n;
  end if;
  src := replace(src, old_cond, new_cond);
  execute src;
end $$;

create or replace function public.update_my_open_job(p_job_number integer, p_patch jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_job public.jobs%rowtype;
  v_allowed text[] := array[
    'crop','task','zip','prefecture','city','town','address',
    'date_label','date_start','date_end','holidays','headcount',
    'pay_type','hourly_wage','daily_wage','work_time','break_time',
    'nearest_station','commute_time','job_exp',
    'beginner_ok','instant_approve_repeat','experienced_preferred','perks',
    'notes','belongings','cautions',
    'overtime_policy','overtime_detail','place_change_scope','task_change_scope',
    'danger_places','danger_tasks','photos',
    'lat','lng','geo_radius_m','geocoded_from'
  ];
  v_bad text;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'reason', 'not_logged_in');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return json_build_object('ok', false, 'reason', 'bad_patch');
  end if;
  select * into v_job from public.jobs where job_number = p_job_number;
  if not found or v_job.farmer_id <> v_uid then
    return json_build_object('ok', false, 'reason', 'not_yours');
  end if;
  if v_job.status <> 'open' then
    return json_build_object('ok', false, 'reason', 'bad_status');
  end if;
  -- 進行中の応募（応募中・面接中・採用済み・作業中）があれば動かさない＝応募した方はこの内容を見て決めている
  if exists (select 1 from public.applications a
              where a.job_number = p_job_number
                and a.status in ('applied','approved','meeting','interview','contracted','working')) then
    return json_build_object('ok', false, 'reason', 'has_applications');
  end if;
  select k into v_bad from jsonb_object_keys(p_patch) k where k <> all(v_allowed) limit 1;
  if v_bad is not null then
    return json_build_object('ok', false, 'reason', 'bad_field', 'field', v_bad);
  end if;

  -- この更新だけ、掲載時の検査と凍結（trg_job_publish_snapshot）を open→open でも走らせる
  perform set_config('cb.edit_open', '1', true);
  update public.jobs set
    crop            = case when p_patch ? 'crop' then p_patch->>'crop' else crop end,
    task            = case when p_patch ? 'task' then p_patch->>'task' else task end,
    zip             = case when p_patch ? 'zip' then p_patch->>'zip' else zip end,
    prefecture      = case when p_patch ? 'prefecture' then p_patch->>'prefecture' else prefecture end,
    city            = case when p_patch ? 'city' then p_patch->>'city' else city end,
    town            = case when p_patch ? 'town' then p_patch->>'town' else town end,
    address         = case when p_patch ? 'address' then p_patch->>'address' else address end,
    date_label      = case when p_patch ? 'date_label' then p_patch->>'date_label' else date_label end,
    date_start      = case when p_patch ? 'date_start' then nullif(p_patch->>'date_start','')::date else date_start end,
    date_end        = case when p_patch ? 'date_end' then nullif(p_patch->>'date_end','')::date else date_end end,
    holidays        = case when p_patch ? 'holidays' then coalesce(p_patch->'holidays', '[]'::jsonb) else holidays end,
    headcount       = case when p_patch ? 'headcount' then nullif(p_patch->>'headcount','')::integer else headcount end,
    pay_type        = case when p_patch ? 'pay_type' then p_patch->>'pay_type' else pay_type end,
    hourly_wage     = case when p_patch ? 'hourly_wage' then p_patch->>'hourly_wage' else hourly_wage end,
    daily_wage      = case when p_patch ? 'daily_wage' then p_patch->>'daily_wage' else daily_wage end,
    work_time       = case when p_patch ? 'work_time' then p_patch->>'work_time' else work_time end,
    break_time      = case when p_patch ? 'break_time' then p_patch->>'break_time' else break_time end,
    nearest_station = case when p_patch ? 'nearest_station' then p_patch->>'nearest_station' else nearest_station end,
    commute_time    = case when p_patch ? 'commute_time' then p_patch->>'commute_time' else commute_time end,
    job_exp         = case when p_patch ? 'job_exp' then p_patch->>'job_exp' else job_exp end,
    beginner_ok     = case when p_patch ? 'beginner_ok' then coalesce((p_patch->>'beginner_ok')::boolean, false) else beginner_ok end,
    instant_approve_repeat = case when p_patch ? 'instant_approve_repeat' then coalesce((p_patch->>'instant_approve_repeat')::boolean, false) else instant_approve_repeat end,
    experienced_preferred  = case when p_patch ? 'experienced_preferred' then coalesce((p_patch->>'experienced_preferred')::boolean, false) else experienced_preferred end,
    perks           = case when p_patch ? 'perks' then nullif(p_patch->'perks', 'null'::jsonb) else perks end,
    notes           = case when p_patch ? 'notes' then p_patch->>'notes' else notes end,
    belongings      = case when p_patch ? 'belongings' then p_patch->>'belongings' else belongings end,
    cautions        = case when p_patch ? 'cautions' then p_patch->>'cautions' else cautions end,
    overtime_policy = case when p_patch ? 'overtime_policy' then p_patch->>'overtime_policy' else overtime_policy end,
    overtime_detail = case when p_patch ? 'overtime_detail' then p_patch->>'overtime_detail' else overtime_detail end,
    place_change_scope = case when p_patch ? 'place_change_scope' then p_patch->>'place_change_scope' else place_change_scope end,
    task_change_scope  = case when p_patch ? 'task_change_scope' then p_patch->>'task_change_scope' else task_change_scope end,
    danger_places   = case when p_patch ? 'danger_places' then coalesce(nullif(p_patch->'danger_places','null'::jsonb), '[]'::jsonb) else danger_places end,
    danger_tasks    = case when p_patch ? 'danger_tasks' then coalesce(nullif(p_patch->'danger_tasks','null'::jsonb), '[]'::jsonb) else danger_tasks end,
    photos          = case when p_patch ? 'photos' then coalesce(nullif(p_patch->'photos','null'::jsonb), '[]'::jsonb) else photos end,
    lat             = case when p_patch ? 'lat' then nullif(p_patch->>'lat','')::numeric else lat end,
    lng             = case when p_patch ? 'lng' then nullif(p_patch->>'lng','')::numeric else lng end,
    geo_radius_m    = case when p_patch ? 'geo_radius_m' then nullif(p_patch->>'geo_radius_m','')::integer else geo_radius_m end,
    geocoded_from   = case when p_patch ? 'geocoded_from' then p_patch->>'geocoded_from' else geocoded_from end
  where job_number = p_job_number and farmer_id = v_uid and status = 'open';
  perform set_config('cb.edit_open', '', true);
  return json_build_object('ok', true, 'job_number', p_job_number);
end;
$$;

revoke all on function public.update_my_open_job(integer, jsonb) from public;
revoke all on function public.update_my_open_job(integer, jsonb) from anon;
grant execute on function public.update_my_open_job(integer, jsonb) to authenticated;
