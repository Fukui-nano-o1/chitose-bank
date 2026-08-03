-- 氏名の横にフリガナを表示（2026-08-03たきと指示）：job_employer_profile に recruiter_name_kana を追加
-- RETURNS TABLE の列変更は CREATE OR REPLACE 不可のため DROP→CREATE。権限は現行と同じ組を明示的に張り直す
-- カナも氏名と同じ開示扱い＝anon には NULL（2026-07-31 訪問者開示レベル第1弾のパターン踏襲）
drop function if exists public.job_employer_profile(integer);
create function public.job_employer_profile(p_job_number integer)
 returns table(nickname text, pr text, avatar_url text, has_transport boolean, transport_area text, has_parking boolean, parking_capacity integer, has_commute_allowance boolean, commute_allowance_detail text, has_bonus boolean, employer_pays_supplies boolean, supplies_cap text, accessory_ok boolean, intro_path text, intro_joy text, intro_crops text, intro_atmosphere text, intro_message text, owner_comment text, unique_point text, always_do text, break_style text, interaction_style text, insurance_items jsonb, insurance_notes jsonb, recruiter_name text, recruiter_address text, recruiter_contact text, recruiter_name_kana text)
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
         case when coalesce(auth.role(),'anon')='anon' then null::text else ep.recruiter_contact end,
         case when coalesce(auth.role(),'anon')='anon' then null::text else ep.recruiter_name_kana end
  from jobs j
  join employer_profiles ep on ep.auth_id = j.farmer_id
  where j.job_number = p_job_number and j.status = 'open';
$function$;
grant execute on function public.job_employer_profile(integer) to anon, authenticated, service_role;
