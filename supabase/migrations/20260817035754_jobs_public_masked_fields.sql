-- 訪問者に「伏せている項目が存在すること」を伝える（2026-08-17たきと指示「文言を非表示にするな。モザイクにしろ」）。
-- これまで anon には town / nearest_station / recruiter_name / recruiter_address / recruiter_contact を
-- NULL で返しており、画面からは行ごと消えていた＝「その情報が無い求人」と見分けがつかなかった。
-- 値そのものは今までどおり一切返さない。返すのは【その項目に値が入っているか】の真偽だけ＝
-- 番地の has_work_address（2026-08-03）と同じ考え方を、他のマスク項目にも広げる。
--
-- 1列（text[]）にまとめた理由：将来マスク項目が増えても列数が変わらない
-- ＝ SETOF jobs_public の関数（admin_preview_job）を毎回直す事故（42P13）を繰り返さないため。
-- 番地だけは既存の has_work_address が担当し続ける（フロントの MaskedAddress が既に使っている）。
--
-- ★2026-07-22ルール：jobs_public の列を変えたら admin_preview_job も同数・同順で更新すること。
--   本migrationでは末尾に1列（masked_fields）追加＝51→52列。両方を同じトランザクションで直す。
--   employer_public_jobs は select jp.* so自動追従（列を列挙していない）。

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
            CASE
                WHEN j.lat IS NULL THEN NULL::integer
                ELSE GREATEST(COALESCE(j.geo_radius_m, 500), 3000)
            END
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
    j.status,
    -- 伏せた項目のうち「実際に値が入っているもの」の名前だけを返す（値は返さない）。
    -- 値が空の項目は入れない＝入力されていない項目にモザイクを描いて「あるのに隠している」と
    -- 見せない（嘘をつかない・憲法3条の精神）。ログイン後は空配列＝マスクなし
        CASE
            WHEN COALESCE(auth.role(), 'anon'::text) = 'anon'::text THEN
              array_remove(ARRAY[
                CASE WHEN j.town IS NOT NULL AND btrim(j.town) <> ''::text THEN 'town' END,
                CASE WHEN j.nearest_station IS NOT NULL AND btrim(j.nearest_station) <> ''::text THEN 'nearest_station' END,
                CASE WHEN j.recruiter_name IS NOT NULL AND btrim(j.recruiter_name) <> ''::text THEN 'recruiter_name' END,
                CASE WHEN j.recruiter_address IS NOT NULL AND btrim(j.recruiter_address) <> ''::text THEN 'recruiter_address' END,
                CASE WHEN j.recruiter_contact IS NOT NULL AND btrim(j.recruiter_contact) <> ''::text THEN 'recruiter_contact' END
              ]::text[], NULL)
            ELSE ARRAY[]::text[]
        END AS masked_fields
   FROM jobs j
     LEFT JOIN employer_profiles ep ON ep.auth_id = j.farmer_id
  WHERE (j.status = 'open'::text OR j.status = 'closed'::text AND j.headcount IS NOT NULL AND j.headcount > 0 AND (( SELECT count(*) AS count
           FROM applications a
          WHERE a.job_number = j.job_number AND a.terms_confirmed_worker_at IS NOT NULL AND a.terms_confirmed_farmer_at IS NOT NULL)) >= j.headcount) AND j.unlisted_reason IS NULL AND NOT is_account_moderated(j.farmer_id);

-- ビューはSELECT専用にする（2026-07-19ルール・作り直すたびに宣言し直す）
revoke all on public.jobs_public from anon, authenticated;
grant select on public.jobs_public to anon, authenticated;

-- 42P13対策：SETOF jobs_public の唯一の列挙関数を同数・同順に合わせる（末尾に masked_fields）。
-- 管理者プレビューはマスクしない画面so常に空配列を返す
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
           j.overtime_policy, j.overtime_detail,
           j.status,
           array[]::text[]
      from public.jobs j
      left join public.employer_profiles ep on ep.auth_id = j.farmer_id
     where j.job_number = p_job_number;
end;
$function$;
