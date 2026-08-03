-- 訪問者（未ログイン＝anon）へのモザイクの徹底（2026-08-03たきと指示）。
-- 実測監査（anonロールで実行して確認）で見つかった3つの穴を塞ぐ。
-- 既存方針「訪問者に見せるのは市区町村まで」を、迂回できない形にする
-- ＝町域名だけ隠しても、座標や駅名から同じ情報が取れては意味がない。
--
-- ① jobs_public の位置情報：town はマスク済みだったが、
--    ・lat/lng が小数6桁（半径500m）でそのまま出ていた＝地図に載せれば町域が判明する
--    ・nearest_station（最寄り駅名）が出ていた＝町域と同等の位置特定情報
--    → anon には座標を小数2桁（約1.1km格子）へ丸め、半径を3000m以上に広げ、駅名は伏せる。
--      ログイン後は従来どおりの精度。JobLocationMapは丸めた座標でも「この辺り」を示せる。
--    ※列数・列順・型は不変＝SETOF jobs_public の admin_preview_job（48列・追随済み）は無改修
-- ② worker_want_again_count のフェイルオープン（実測で anon に {ok:true} が返っていた）
-- ③ 内部専用RPC（resolve_actor_name／unread_count_for）がクライアントから直接叩けた

create or replace view public.jobs_public as
 SELECT j.job_number,
    j.crop,
    j.task,
    j.prefecture,
    j.city,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.town
        END AS town,
    j.date_label,
    j.date_start,
    j.date_end,
    j.headcount,
    j.pay_type,
    j.hourly_wage,
    j.daily_wage,
    j.work_time,
    j.break_time,
    -- 最寄り駅は町域と同等の位置特定情報so訪問者には伏せる（2026-08-03）
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.nearest_station
        END AS nearest_station,
    j.commute_time,
    j.job_exp,
    j.notes,
    j.belongings,
    j.cautions,
    j.danger_places,
    j.danger_tasks,
    j.photos,
    j.created_at,
    -- 座標は訪問者には約1.1km格子へ丸める（町域が特定できない粒度・2026-08-03）
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN round(j.lat, 2)
            ELSE j.lat
        END AS lat,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN round(j.lng, 2)
            ELSE j.lng
        END AS lng,
    -- 丸めた座標に見合う広さにする（座標が無い求人は従来どおりNULL）
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text
              THEN CASE WHEN j.lat IS NULL THEN NULL::integer
                        ELSE GREATEST(COALESCE(j.geo_radius_m, 500), 3000) END
            ELSE j.geo_radius_m
        END AS geo_radius_m,
    j.full_pay_guarantee,
    j.beginner_ok,
    j.instant_approve_repeat,
    j.opened_at,
    j.perks,
    j.experienced_preferred,
    ( SELECT count(*) AS count
           FROM applications a
          WHERE a.job_number = j.job_number AND a.terms_confirmed_worker_at IS NOT NULL AND a.terms_confirmed_farmer_at IS NOT NULL) AS hired_count,
    ep.nickname AS employer_nickname,
    ep.avatar_url AS employer_avatar_url,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.recruiter_name
        END AS recruiter_name,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.recruiter_address
        END AS recruiter_address,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.recruiter_contact
        END AS recruiter_contact,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text
            ELSE j.address
        END AS work_address,
    j.insurance_snapshot,
    j.profile_snapshot_at,
    j.pay_method,
    j.pay_timing,
    j.wage_closing_rule,
    j.holidays,
    j.address IS NOT NULL AND btrim(j.address) <> ''::text AS has_work_address
   FROM jobs j
     LEFT JOIN employer_profiles ep ON ep.auth_id = j.farmer_id
  WHERE j.status = 'open'::text AND NOT is_account_moderated(j.farmer_id);

-- ② worker_want_again_count：未ログインを先に弾く（フェイルオープンの根治）
--    入口が `auth.uid() <> p_worker_id and not exists(...)` だと、anonでは auth.uid() が NULL →
--    条件全体が NULL＝偽と評価され、拒否に入らず件数を返していた
--    （2026-07-29に worker_trust_info で直したのと同じ型の穴が、この関数に残っていた）
create or replace function public.worker_want_again_count(p_worker_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;
  if auth.uid() <> p_worker_id and not exists (
    select 1 from public.applications a
    where a.worker_id = p_worker_id and a.farmer_id = auth.uid()
  ) then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;

  select count(*) into v_count from public.reviews
    where reviewee_id = p_worker_id and direction = 'farmer_to_worker' and want_again = true;

  return json_build_object('ok', true, 'want_again_count', v_count);
end;
$function$;

-- 入口でもanonを拒む（二重の壁・worker_trust_info一括版と同じ作法）。フロントは本人分のみ呼ぶ
revoke execute on function public.worker_want_again_count(uuid) from public, anon;
grant execute on function public.worker_want_again_count(uuid) to authenticated;

-- ③ 内部専用RPCはクライアントから直接叩けないようにする。
--    resolve_actor_name＝任意のUUIDでニックネーム（未設定ならメール頭2文字）が引けた
--    unread_count_for＝他人のUUIDでその人の未読件数が引けた
--    どちらもフロント未使用で、他のSECURITY DEFINER関数（get_my_calendar_jobs／my_todo_items／
--    job_ref／cancel_application 等）の内部からのみ呼ばれる＝内部呼び出しは定義者権限で走るので壊れない
revoke execute on function public.resolve_actor_name(uuid) from public, anon, authenticated;
revoke execute on function public.unread_count_for(uuid) from public, anon, authenticated;
