-- 時間外労働の有無と目安（2026-08-03たきと指示「持ち物と備考・注意の下に時間外労働の有無
-- （どれくらいの時間）を明記。同じフローページに入力項目を追加」）。
-- 所定の勤務時間を超える労働の有無は労働条件の明示事項。求人ごとに変わる条件なので、
-- 雇い手プロフィール（受動喫煙のような事業所の属性）ではなく jobs に直接持つ。
-- overtime_policy: 'なし' / 'あり' / NULL（未設定）。overtime_detail: 'あり' の時の目安（自由記述）
-- ※本migrationはMCP直接適用済み（version 20260803150746）。2026-07-21ルールに従いrepoへ写経
alter table public.jobs add column if not exists overtime_policy text;
alter table public.jobs add column if not exists overtime_detail text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_overtime_policy_check') then
    alter table public.jobs add constraint jobs_overtime_policy_check
      check (overtime_policy is null or overtime_policy in ('なし','あり'));
  end if;
end $$;

-- jobs_public に末尾追加（公開情報＝募集条件の一部・個人情報ではない）
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
    (j.address IS NOT NULL AND btrim(j.address) <> ''::text) AS has_work_address,
    j.overtime_policy,
    j.overtime_detail
   FROM jobs j
     LEFT JOIN employer_profiles ep ON ep.auth_id = j.farmer_id
  WHERE j.status = 'open'::text AND NOT is_account_moderated(j.farmer_id);

-- 2026-07-22ルール：jobs_public に列を足したら RETURNS SETOF jobs_public の関数も同数・同順に合わせる
create or replace function public.admin_preview_job(p_job_number integer)
 returns setof jobs_public
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return;
  end if;
  return query
    select j.job_number, j.crop, j.task, j.prefecture, j.city, j.town,
           j.date_label, j.date_start, j.date_end, j.headcount,
           j.pay_type, j.hourly_wage, j.daily_wage, j.work_time, j.break_time,
           j.nearest_station, j.commute_time, j.job_exp, j.notes, j.belongings, j.cautions,
           j.danger_places, j.danger_tasks, j.photos, j.created_at,
           j.lat, j.lng, j.geo_radius_m,
           j.full_pay_guarantee, j.beginner_ok, j.instant_approve_repeat,
           j.opened_at, j.perks, j.experienced_preferred,
           (select count(*) from public.applications a
             where a.job_number = j.job_number
               and a.terms_confirmed_worker_at is not null
               and a.terms_confirmed_farmer_at is not null) as hired_count,
           ep.nickname, ep.avatar_url,
           j.recruiter_name, j.recruiter_address, j.recruiter_contact, j.address,
           j.insurance_snapshot, j.profile_snapshot_at,
           j.pay_method, j.pay_timing, j.wage_closing_rule,
           j.holidays,
           (j.address is not null and btrim(j.address) <> ''),
           j.overtime_policy, j.overtime_detail
      from public.jobs j
      left join public.employer_profiles ep on ep.auth_id = j.farmer_id
     where j.job_number = p_job_number;
end;
$function$;
