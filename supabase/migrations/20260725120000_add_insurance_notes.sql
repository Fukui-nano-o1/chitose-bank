-- 保険の準備・自己申告に「項目ごとの自由記述メモ」を追加（2026-07-25）。
-- 既存の insurance_items（キー配列 jsonb）は温存し、insurance_notes（{キー:説明文} jsonb）を追加＝
-- 追加可能・削除可能・他を壊さない（CLAUDE.md原則）。求人詳細タブ／確認ページの各保険項目の
-- タップ展開に、運営の定型説明＋農家の自由記述メモを出すための土台。
alter table public.employer_profiles
  add column if not exists insurance_notes jsonb not null default '{}'::jsonb;

-- 働き手向け求人詳細のRPCに insurance_notes を追加（RETURNS TABLE の変更なので drop→create）。
-- 他関数からの依存なしを確認済み。既存の返却列は順序も含めそのまま、末尾に1列追加。
drop function if exists public.job_employer_profile(integer);
create function public.job_employer_profile(p_job_number integer)
 returns table(nickname text, pr text, avatar_url text, has_transport boolean, transport_area text, has_parking boolean, parking_capacity integer, has_commute_allowance boolean, commute_allowance_detail text, has_bonus boolean, employer_pays_supplies boolean, supplies_cap text, accessory_ok boolean, intro_path text, intro_joy text, intro_crops text, intro_atmosphere text, intro_message text, owner_comment text, unique_point text, always_do text, break_style text, interaction_style text, insurance_items jsonb, insurance_notes jsonb)
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
         ep.insurance_items, ep.insurance_notes
  from jobs j
  join employer_profiles ep on ep.auth_id = j.farmer_id
  where j.job_number = p_job_number and j.status = 'open';
$function$;
