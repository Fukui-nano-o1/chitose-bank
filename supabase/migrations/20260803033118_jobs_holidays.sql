-- 求人の休日（2026-08-03たきと指示「契約期間設定に休日を設ける」）
-- jobs.holidays: 期間内の休みの日（["YYYY-MM-DD",...]）。単日求人・休日なしは []。
-- 入力は求人フローstep4（休日ボタン→カレンダータップ）。表示は詳細・確認・審査プレビューのカレンダー。
-- 働き手の「来られる日」候補・農家の「働く日を決める」候補からは休日を除外する（フロント側）。
-- ※本migrationはMCP直接適用済み（version 20260803033118）。2026-07-21ルールに従いrepoへ写経
alter table public.jobs add column if not exists holidays jsonb not null default '[]'::jsonb;

-- jobs_public に holidays を末尾追加（CREATE OR REPLACE VIEW は末尾追加のみ可能）。
-- 公開情報として妥当（募集条件の一部・個人情報ではない）
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
    j.holidays
   FROM jobs j
     LEFT JOIN employer_profiles ep ON ep.auth_id = j.farmer_id
  WHERE j.status = 'open'::text AND NOT is_account_moderated(j.farmer_id);

-- 2026-07-22ルール：jobs_public に列を足したら RETURNS SETOF jobs_public の関数も同数・同順に合わせる。
-- admin_preview_job は明示列挙ので末尾に j.holidays を追加。employer_public_jobs は jp.* ので自動追従（変更不要）
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
           j.holidays
      from public.jobs j
      left join public.employer_profiles ep on ep.auth_id = j.farmer_id
     where j.job_number = p_job_number;
end;
$function$;

-- my_farm_jobs にも holidays を追加（SECURITY INVOKER・自分の求人のみ）：
-- 農家の「働く日を決める」モーダルの候補から休日を除くために使う
create or replace function public.my_farm_jobs()
 returns json
 language sql
 set search_path to 'public'
as $function$
  with j as (
    select job_number, crop, task, date_label, prefecture, city, pay_type, hourly_wage, daily_wage,
           photos, status, date_start, date_end, work_time, opened_at, holidays
    from jobs where farmer_id = auth.uid()
  )
  select json_build_object(
    'jobs', coalesce((select json_agg(to_jsonb(x) order by x.job_number desc) from j x), '[]'::json),
    'q_unanswered', coalesce((select json_object_agg(q.job_number::text, q.cnt) from (
        select job_number, count(*)::int cnt from job_questions
        where job_number in (select job_number from j) and answer is null and hidden = false
        group by job_number) q), '{}'::json)
  );
$function$;
