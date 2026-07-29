-- 募集者情報を求人詳細に出す（2026-07-27たきと指示・法令上の明示事項）
-- 労働者の募集広告に必要な明示事項のうち、募集者の氏名/名称・住所/所在地・連絡先を
-- 求人詳細から読めるようにする（業務内容=crop/task、就業場所=prefecture/city/town、
-- 報酬=pay_type/hourly_wage/daily_wage は jobs_public に既にある）。
-- 返り値の列を増やすためCREATE OR REPLACEでは不可＝DROPしてから作り直す（呼び出し側の列順に注意）。
drop function if exists public.job_employer_profile(integer);

create function public.job_employer_profile(p_job_number integer)
returns table(
  nickname text, pr text, avatar_url text,
  has_transport boolean, transport_area text,
  has_parking boolean, parking_capacity integer,
  has_commute_allowance boolean, commute_allowance_detail text,
  has_bonus boolean,
  employer_pays_supplies boolean, supplies_cap text,
  accessory_ok boolean,
  intro_path text, intro_joy text, intro_crops text,
  intro_atmosphere text, intro_message text, owner_comment text,
  unique_point text, always_do text, break_style text, interaction_style text,
  insurance_items jsonb, insurance_notes jsonb,
  recruiter_name text, recruiter_address text, recruiter_contact text
)
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
         ep.recruiter_name, ep.recruiter_address, ep.recruiter_contact
  from jobs j
  join employer_profiles ep on ep.auth_id = j.farmer_id
  where j.job_number = p_job_number and j.status = 'open';
$function$;

grant execute on function public.job_employer_profile(integer) to anon, authenticated;
