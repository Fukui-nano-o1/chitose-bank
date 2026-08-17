-- 訪問者（未ログイン＝anon）への位置情報マスクの復旧（2026-08-06・実機一周で発見）
--
-- 【何が起きていたか】2026-08-03の anon マスク徹底（20260803131655）で、jobs_public は
--   ・座標 lat/lng を小数2桁（約1.1km格子）へ丸める
--   ・geo_radius_m を3000m以上に広げる
--   ・nearest_station（最寄り駅名）を伏せる
-- を入れていたが、2026-08-06の 20260806013953（終了した求人も並べる）で、
-- マスク導入前のビュー定義を土台に create or replace したため、この3点がまるごと外れていた。
-- 町域・募集主・番地のマスクは残っていたので気づきにくい状態だった。
--
-- 【実測（本番・anonロールで実行）】座標の小数桁=6・半径の最小=500・駅名がある行=12/12
-- ＝町域を伏せていても、地図に載せれば就業場所がほぼ特定できる状態だった。
-- モザイクの原則（2026-08-03）：ある項目を隠したら、同じ情報を導ける別の項目も同時に塞ぐ。
--
-- 【この修正】列数・列順・型は不変（51列）ので、RETURNS SETOF jobs_public の
-- admin_preview_job（列を列挙する唯一の関数）は無改修で追随する（2026-07-22ルール）。
-- employer_public_jobs は select jp.* ので自動追従。
-- status in ('open','closed')・unlisted_reason is null・is_account_moderated の除外は不変。
--
-- 【教訓】ビューを create or replace で作り直すときは、必ず「今の本番の定義」を土台にする。
-- 過去のマイグレーションからコピーすると、その後に入ったマスクが静かに消える。

create or replace view public.jobs_public as
 select j.job_number,
    j.crop,
    j.task,
    j.prefecture,
    j.city,
        case when coalesce(auth.role(), 'anon'::text) = 'anon'::text then null::text
             else j.town end as town,
    j.date_label,
    j.date_start,
    j.date_end,
    j.headcount,
    j.pay_type,
    j.hourly_wage,
    j.daily_wage,
    j.work_time,
    j.break_time,
    -- 最寄り駅は町域と同等の位置特定情報ので訪問者には伏せる（2026-08-03）
        case when coalesce(auth.role(), 'anon'::text) = 'anon'::text then null::text
             else j.nearest_station end as nearest_station,
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
        case when coalesce(auth.role(), 'anon'::text) = 'anon'::text then round(j.lat, 2)
             else j.lat end as lat,
        case when coalesce(auth.role(), 'anon'::text) = 'anon'::text then round(j.lng, 2)
             else j.lng end as lng,
    -- 丸めた座標に見合う広さにする（座標が無い求人は従来どおりNULL）
        case when coalesce(auth.role(), 'anon'::text) = 'anon'::text
             then case when j.lat is null then null::integer
                       else greatest(coalesce(j.geo_radius_m, 500), 3000) end
             else j.geo_radius_m end as geo_radius_m,
    j.full_pay_guarantee,
    j.beginner_ok,
    j.instant_approve_repeat,
    j.opened_at,
    j.perks,
    j.experienced_preferred,
    ( select count(*) as count
        from applications a
       where a.job_number = j.job_number
         and a.terms_confirmed_worker_at is not null
         and a.terms_confirmed_farmer_at is not null) as hired_count,
    ep.nickname as employer_nickname,
    ep.avatar_url as employer_avatar_url,
        case when coalesce(auth.role(), 'anon'::text) = 'anon'::text then null::text
             else j.recruiter_name end as recruiter_name,
        case when coalesce(auth.role(), 'anon'::text) = 'anon'::text then null::text
             else j.recruiter_address end as recruiter_address,
        case when coalesce(auth.role(), 'anon'::text) = 'anon'::text then null::text
             else j.recruiter_contact end as recruiter_contact,
        case when coalesce(auth.role(), 'anon'::text) = 'anon'::text then null::text
             else j.address end as work_address,
    j.insurance_snapshot,
    j.profile_snapshot_at,
    j.pay_method,
    j.pay_timing,
    j.wage_closing_rule,
    j.holidays,
    j.address is not null and btrim(j.address) <> ''::text as has_work_address,
    j.overtime_policy,
    j.overtime_detail,
    j.status
   from jobs j
     left join employer_profiles ep on ep.auth_id = j.farmer_id
  where (j.status = any (array['open'::text, 'closed'::text]))
    and j.unlisted_reason is null
    and not is_account_moderated(j.farmer_id);

-- ビューはSELECT専用にする（2026-07-19ルール）
revoke all on public.jobs_public from anon, authenticated;
grant select on public.jobs_public to anon, authenticated;
