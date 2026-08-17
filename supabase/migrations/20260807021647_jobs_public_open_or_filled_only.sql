-- 公開するのは「応募可能な求人（open）」と「満員の求人」のみ（2026-08-07たきと指示
-- 「やはり、応募可能な求人と満員の求人のみ公開する」）。
--
-- 【経緯】2026-08-05「さがすに終了した求人を並べる」で closed を全件公開に広げたが、
--   本指示により絞り直す。closed のうち公開するのは【満員＝採用が募集人数に達して
--   終わった求人】だけ。期間終了しただけ（採用ゼロ・未充足）の closed は公開しない。
--   農家が取り下げた求人（unlisted_reason 非NULL＝一時停止・削除）の除外は前回
--   （20260806020827）のまま不変。
--
-- 【満員の定義】確定採用（terms_confirmed_worker_at・terms_confirmed_farmer_at 双方あり）
--   の数 >= headcount。ビューの hired_count 列・フロントの満員バッジ（filled）と同じ数え方
--   ＝サイト内に「満員」の定義が2種類現れない。headcount が NULL/0 の行は満員になり得ない。
--
-- 【変えるのは WHERE だけ】列の構成は一切不変ので、RETURNS SETOF jobs_public の
--   admin_preview_job・employer_public_jobs は無改修で追従（2026-07-22ルール）。
--   雇い手プロフィールの「過去の求人」も同じ絞りに自動で揃う（employer_public_jobs は jp.*）。
--   フロントも無改修：JobCard は filled を closed より先に判定するため、満員で終了した求人は
--   「募集終了（満員）」帯で表示される。

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
    j.address IS NOT NULL AND btrim(j.address) <> ''::text AS has_work_address,
    j.overtime_policy,
    j.overtime_detail,
    j.status
   FROM jobs j
     LEFT JOIN employer_profiles ep ON ep.auth_id = j.farmer_id
  WHERE (
        j.status = 'open'::text
        OR (
          j.status = 'closed'::text
          AND j.headcount IS NOT NULL AND j.headcount > 0
          AND ( SELECT count(*)
                  FROM applications a
                 WHERE a.job_number = j.job_number
                   AND a.terms_confirmed_worker_at IS NOT NULL
                   AND a.terms_confirmed_farmer_at IS NOT NULL) >= j.headcount
        )
    )
    AND j.unlisted_reason IS NULL          -- 農家が取り下げた求人は公開しない（20260806020827・不変）
    AND NOT is_account_moderated(j.farmer_id);

-- 権限は従来どおり SELECT のみ（2026-07-19ルール：ビューはSELECT専用）
revoke all on public.jobs_public from anon, authenticated;
grant select on public.jobs_public to anon, authenticated;
