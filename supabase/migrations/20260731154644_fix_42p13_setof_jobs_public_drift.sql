-- 42P13（return type mismatch）修正＋列ドリフト構造根絶（2026-07-31・たきと指示）
-- 原因：jobs_public に recruiter系4列が足された（2026-07-30 backfill）際、SETOF jobs_public 関数の
--       本体SELECTが37列のまま残り、呼び出し時に 42P13 で落ちていた。
-- ① employer_public_jobs：本体を SELECT * FROM jobs_public に書き換え。
--    ビュー参照にすることで anon マスク（town/recruiter）を自動継承し、今後ビューに列を足しても壊れない。
--    絞り込み（同じ雇い手の公開中求人）は job_number の IN 条件で維持。jobs_public は farmer_id を
--    出さないため、farmer_id 一致は base の jobs から引く（本関数は SECURITY DEFINER）。
-- ② admin_preview_job：pending 行も見るため jobs_public（status='open' 限定）は参照できない。
--    ビューと同一の41列・同順へ整列する（列変更時は本関数を連動更新すること＝CLAUDE.mdに明記）。
--    admin 限定（非adminは0行返し）のため recruiter系は素の列でよい（anonは行自体が返らない）。

-- ① ビュー参照へ（構造ドリフトの根絶）
create or replace function public.employer_public_jobs(p_job_number integer)
 returns setof jobs_public
 language sql
 security definer
 set search_path to 'public'
as $function$
  select jp.*
    from public.jobs_public jp
   where jp.job_number in (
     select j.job_number from public.jobs j
      where j.farmer_id = (select farmer_id from public.jobs where job_number = p_job_number)
   )
$function$;

-- ② 41列へ整列（pending行が必要なのでビュー参照不可）
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
           j.recruiter_name, j.recruiter_address, j.recruiter_contact, j.address
      from public.jobs j
      left join public.employer_profiles ep on ep.auth_id = j.farmer_id
     where j.job_number = p_job_number;
end;
$function$;
