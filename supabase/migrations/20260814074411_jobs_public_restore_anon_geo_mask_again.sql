-- 訪問者（anon）への位置マスクの再復旧（2026-08-14・定期点検①で検出した再発）
--
-- 【何が起きていたか】20260807021647_jobs_public_open_or_filled_only が、位置マスク
--   （20260806110501）導入前の定義を土台に jobs_public を作り直したため、anonマスクのうち
--   位置系3点（座標の小数2桁丸め・半径3000m・最寄り駅の非表示）だけが静かに外れていた。
--   町域・募集主3項目・番地のマスクは残っていたため気づきにくい（2026-08-06 実害1と同型・2回目）。
--   実測：anon が 座標6桁・半径500・駅名9/9件を取得できた＝地図に載せれば町域を伏せた意味が消える。
--
-- 【直し方】★今の本番の定義を土台に、位置系4式（lat/lng/geo_radius_m/nearest_station）だけを
--   マスク版に戻す。列の数・順は不変＝admin_preview_job（42P13ルール）への連動不要。
--   filled-closed の表示条件（20260807021647）・has_work_address・status 等の後続変更はすべて維持。
--
-- 【教訓の再掲＋恒久策】ビューを作り直す時は必ず「今の本番の定義」を土台にする。
--   点検 audit.sql ① がこの型を検出する（今回も検出した）＝ビューを触った日は必ず流すこと。

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
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN round(j.lat, 2)
            ELSE j.lat
        END AS lat,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN round(j.lng, 2)
            ELSE j.lng
        END AS lng,
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN
                CASE WHEN j.lat IS NULL THEN NULL::integer
                     ELSE greatest(COALESCE(j.geo_radius_m, 500), 3000) END
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
    j.address IS NOT NULL AND btrim(j.address) <> ''::text AS has_work_address,
    j.overtime_policy,
    j.overtime_detail,
    j.status
   FROM jobs j
     LEFT JOIN employer_profiles ep ON ep.auth_id = j.farmer_id
  WHERE (j.status = 'open'::text OR j.status = 'closed'::text AND j.headcount IS NOT NULL AND j.headcount > 0 AND (( SELECT count(*) AS count
           FROM applications a
          WHERE a.job_number = j.job_number AND a.terms_confirmed_worker_at IS NOT NULL AND a.terms_confirmed_farmer_at IS NOT NULL)) >= j.headcount) AND j.unlisted_reason IS NULL AND NOT is_account_moderated(j.farmer_id);

-- ビューはSELECT専用ルール（2026-07-19）：作り直し後に必ず再宣言
revoke all on public.jobs_public from anon, authenticated;
grant select on public.jobs_public to anon, authenticated;
