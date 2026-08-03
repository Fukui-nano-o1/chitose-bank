-- 訪問者開示レベル 第1弾（2026-07-31・たきと指示）
-- ① job_employer_profile：anon（未ログイン）に recruiter_name/address/contact を NULL で返す
--    （jobs_public はこの3列を既にanonマスク済みだが、フロントが本RPCへフォールバックし迂回していた穴を塞ぐ）
-- ② jobs_public：town を anon に NULL マスク（prefecture/city は開示のまま）。既存のrecruiter系と同一パターン
-- lat/lng/geo_radius_m には触らない（座標の扱いはD3で別途決定）。列の順序・他列・SETOF関数の構造は不変。
-- マスク条件は auth.role()='anon' のみ＝authenticated は全開示（労働局助言による募集広告の明示義務）。

-- ① 募集者情報RPCのanonマスク
create or replace function public.job_employer_profile(p_job_number integer)
 returns table(nickname text, pr text, avatar_url text, has_transport boolean, transport_area text, has_parking boolean, parking_capacity integer, has_commute_allowance boolean, commute_allowance_detail text, has_bonus boolean, employer_pays_supplies boolean, supplies_cap text, accessory_ok boolean, intro_path text, intro_joy text, intro_crops text, intro_atmosphere text, intro_message text, owner_comment text, unique_point text, always_do text, break_style text, interaction_style text, insurance_items jsonb, insurance_notes jsonb, recruiter_name text, recruiter_address text, recruiter_contact text)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select ep.nickname, ep.pr, ep.avatar_url,
         ep.has_transport, ep.transport_area,
         ep.has_parking, ep.parking_capacity,
         ep.has_commute_allowance, ep.commute_allowance_detail,
         ep.has_bonus,
         ep.employer_pays_supplies, ep.supplies_cap,
         ep.accessory_ok,
         ep.intro_path, ep.intro_joy, ep.intro_crops,
         ep.intro_atmosphere, ep.intro_message, ep.owner_comment,
         ep.unique_point, ep.always_do, ep.break_style, ep.interaction_style,
         ep.insurance_items, ep.insurance_notes,
         case when coalesce(auth.role(),'anon')='anon' then null::text else ep.recruiter_name end,
         case when coalesce(auth.role(),'anon')='anon' then null::text else ep.recruiter_address end,
         case when coalesce(auth.role(),'anon')='anon' then null::text else ep.recruiter_contact end
  from jobs j
  join employer_profiles ep on ep.auth_id = j.farmer_id
  where j.job_number = p_job_number and j.status = 'open';
$function$;

-- ② jobs_public の town を anon マスク（他列・順序は不変・SETOF関数の構造にも影響なし）
create or replace view public.jobs_public as
 SELECT j.job_number,
    j.crop,
    j.task,
    j.prefecture,
    j.city,
    CASE WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text ELSE j.town END AS town,
    j.date_label,
    j.date_start,
    j.date_end,
    j.headcount,
    j.pay_type,
    j.hourly_wage,
    j.daily_wage,
    j.work_time,
    j.break_time,
    j.nearest_station,
    j.commute_time,
    j.job_exp,
    j.notes,
    j.belongings,
    j.cautions,
    j.danger_places,
    j.danger_tasks,
    j.photos,
    j.created_at,
    j.lat,
    j.lng,
    j.geo_radius_m,
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
        CASE WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text ELSE j.recruiter_name END AS recruiter_name,
        CASE WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text ELSE j.recruiter_address END AS recruiter_address,
        CASE WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text ELSE j.recruiter_contact END AS recruiter_contact,
        CASE WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN NULL::text ELSE j.address END AS work_address
   FROM jobs j
     LEFT JOIN employer_profiles ep ON ep.auth_id = j.farmer_id
  WHERE j.status = 'open'::text AND NOT is_account_moderated(j.farmer_id);

-- ビューはSELECT専用（CLAUDE.md 2026-07-19・CREATE OR REPLACEでは権限は保持されるが明示的に再確認）
revoke all on public.jobs_public from anon, authenticated;
grant select on public.jobs_public to anon, authenticated;
