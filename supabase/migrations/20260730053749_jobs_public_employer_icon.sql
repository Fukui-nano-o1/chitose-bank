-- 写真の無い求人カードに求人者のアイコンを出す（2026-07-30たきと指示）。
-- さがす一覧は jobs_public しか読まないため、雇い手のニックネームとアイコンを2列だけ追加する。
-- 公開範囲は増えない：同じ2項目は job_employer_profile（公開中の求人・anon可）が既に求人詳細で返している。
-- farmer_id は引き続き出さない（データ憲法）。
-- ★jobs_public に列を足したら SETOF 関数も同数・同順に直す（CLAUDE.md 2026-07-22・呼び出し時に落ちるため）
--   対象：admin_preview_job（管理タブの審査プレビュー）／employer_public_jobs（雇い手プロフィールの過去の求人）
create or replace view public.jobs_public as
 SELECT j.job_number,
    j.crop,
    j.task,
    j.prefecture,
    j.city,
    j.town,
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
    ep.avatar_url AS employer_avatar_url
   FROM jobs j
   LEFT JOIN employer_profiles ep ON ep.auth_id = j.farmer_id
  WHERE j.status = 'open'::text AND NOT is_account_moderated(j.farmer_id);

-- ビューはSELECT専用（CLAUDE.md 2026-07-19）
revoke all on public.jobs_public from anon, authenticated;
grant select on public.jobs_public to anon, authenticated;

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
           ep.nickname, ep.avatar_url
      from public.jobs j
      left join public.employer_profiles ep on ep.auth_id = j.farmer_id
     where j.job_number = p_job_number;
end;
$function$;

create or replace function public.employer_public_jobs(p_job_number integer)
 returns setof jobs_public
 language sql
 security definer
 set search_path to 'public'
as $function$
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
         ep.nickname, ep.avatar_url
    from public.jobs j
    left join public.employer_profiles ep on ep.auth_id = j.farmer_id
   where j.status = 'open'
     and j.farmer_id = (select farmer_id from public.jobs where job_number = p_job_number)
$function$;
