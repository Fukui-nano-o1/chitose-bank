-- 求人内掲載への同意済みYouTube URLだけを公開求人ビューへ出す。
-- jobs_publicの既存公開範囲・anonマスク条件は維持し、末尾にwork_video_urlのみ追加。
create or replace view public.jobs_public with (security_invoker=true) as
select j.job_number, j.crop, j.task, j.prefecture, j.city,
 case when coalesce(auth.role(),'anon')='anon' then null else j.town end as town,
 j.date_label,j.date_start,j.date_end,j.headcount,j.pay_type,j.hourly_wage,j.daily_wage,j.work_time,j.break_time,
 case when coalesce(auth.role(),'anon')='anon' then null else j.nearest_station end as nearest_station,
 j.commute_time,j.job_exp,j.notes,j.belongings,j.cautions,j.danger_places,j.danger_tasks,j.photos,j.created_at,
 case when coalesce(auth.role(),'anon')='anon' then round(j.lat,2) else j.lat end as lat,
 case when coalesce(auth.role(),'anon')='anon' then round(j.lng,2) else j.lng end as lng,
 case when coalesce(auth.role(),'anon')='anon' then case when j.lat is null then null else greatest(coalesce(j.geo_radius_m,500),3000) end else j.geo_radius_m end as geo_radius_m,
 j.full_pay_guarantee,j.beginner_ok,j.instant_approve_repeat,j.opened_at,j.perks,j.experienced_preferred,
 (select count(*) from applications a where a.job_number=j.job_number and a.terms_confirmed_worker_at is not null and a.terms_confirmed_farmer_at is not null) as hired_count,
 ep.nickname as employer_nickname,ep.avatar_url as employer_avatar_url,
 case when coalesce(auth.role(),'anon')='anon' then null else j.recruiter_name end as recruiter_name,
 case when coalesce(auth.role(),'anon')='anon' then null else j.recruiter_address end as recruiter_address,
 case when coalesce(auth.role(),'anon')='anon' then null else j.recruiter_contact end as recruiter_contact,
 case when coalesce(auth.role(),'anon')='anon' then null else j.address end as work_address,
 j.insurance_snapshot,j.profile_snapshot_at,j.pay_method,j.pay_timing,j.wage_closing_rule,j.holidays,
 j.address is not null and btrim(j.address)<>'' as has_work_address,j.overtime_policy,j.overtime_detail,j.status,
 case when coalesce(auth.role(),'anon')='anon' then array_remove(array[
  case when j.town is not null and btrim(j.town)<>'' then 'town' end,
  case when j.nearest_station is not null and btrim(j.nearest_station)<>'' then 'nearest_station' end,
  case when j.recruiter_name is not null and btrim(j.recruiter_name)<>'' then 'recruiter_name' end,
  case when j.recruiter_address is not null and btrim(j.recruiter_address)<>'' then 'recruiter_address' end,
  case when j.recruiter_contact is not null and btrim(j.recruiter_contact)<>'' then 'recruiter_contact' end],null)
 else array[]::text[] end as masked_fields,
 j.place_change_scope,j.task_change_scope,j.contract_renewal,j.retirement_terms,j.labor_insurance_status,
 case when j.work_video_job_consent is true then j.work_video_url else null end as work_video_url
from jobs j left join employer_profiles ep on ep.auth_id=j.farmer_id
where (j.status='open' or (j.status='closed' and j.headcount is not null and j.headcount>0 and
 (select count(*) from applications a where a.job_number=j.job_number and a.terms_confirmed_worker_at is not null and a.terms_confirmed_farmer_at is not null)>=j.headcount))
and j.unlisted_reason is null and not is_account_moderated(j.farmer_id);
