-- 関わり方の質問セット拡充（2026-08-14たきと指示「作業の関わり方をもっと充実させて。他の質問を足すのも良し」）。
-- 既存 interaction_style（作業中の関わり方）に、教え方・作業中の雰囲気・質問相談のしかたの3問を追加。
-- すべて選択式＝自由記述のNG検査・公開フローに乗らない事実の申告。値の正はフロント lib/utils の
-- HOST_STYLE_QUESTIONS（唯一のソース）。
-- 実測（anonロール）：job_employer_profile が従来どおり1行返り・募集者マスク維持・新3列参照可。
alter table public.employer_profiles
  add column if not exists teaching_style text,
  add column if not exists chat_style text,
  add column if not exists question_style text;

-- 公開ビューへ末尾追加（現行本番定義を土台に・2026-08-06教訓。OR REPLACE＝末尾追加のみ可・権限は維持）
create or replace view public.employer_profiles_public as
 SELECT auth_id, nickname, pr, avatar_url, has_transport, has_parking, has_commute_allowance,
    has_bonus, employer_pays_supplies, accessory_ok, parking_capacity, commute_allowance_detail,
    transport_area, supplies_cap, intro_path, intro_joy, intro_crops, intro_atmosphere,
    intro_message, owner_comment, staff_count, commitment, unique_point, always_do, break_style,
    interaction_style, place_prefecture, place_city, place_town, created_at, insurance_items,
    teaching_style, chat_style, question_style
   FROM employer_profiles;

-- 求人詳細の農園紹介RPC：返り値の列が増える＝return typeはREPLACE不可のでDROPして作り直す。
-- ★作り直すとPUBLIC自動EXECUTEが付くため、revoke from public→明示grantを必ず再宣言（2026-08-06教訓）。
--   このRPCは訪問者にも見せる仕様（anon許可のホワイトリスト・2026-08-07 audit③）
drop function if exists public.job_employer_profile(integer);
create function public.job_employer_profile(p_job_number integer)
 returns table(nickname text, pr text, avatar_url text, has_transport boolean, transport_area text, has_parking boolean, parking_capacity integer, has_commute_allowance boolean, commute_allowance_detail text, has_bonus boolean, employer_pays_supplies boolean, supplies_cap text, accessory_ok boolean, intro_path text, intro_joy text, intro_crops text, intro_atmosphere text, intro_message text, owner_comment text, unique_point text, always_do text, break_style text, interaction_style text, insurance_items jsonb, insurance_notes jsonb, recruiter_name text, recruiter_address text, recruiter_contact text, recruiter_name_kana text, teaching_style text, chat_style text, question_style text)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select
         -- 表示情報（凍結対象外・常に最新でよい）：名前・紹介文・アイコン・人柄
         ep.nickname, ep.pr, ep.avatar_url,
         -- 待遇10項目は掲載時に凍結した jobs.perks から返す（この求人の広告内容そのもの）
         coalesce((j.perks->>'has_transport')::boolean, false),
         coalesce(j.perks->>'transport_area', ''),
         coalesce((j.perks->>'has_parking')::boolean, false),
         (j.perks->>'parking_capacity')::integer,
         coalesce((j.perks->>'has_commute_allowance')::boolean, false),
         coalesce(j.perks->>'commute_allowance_detail', ''),
         coalesce((j.perks->>'has_bonus')::boolean, false),
         coalesce((j.perks->>'employer_pays_supplies')::boolean, false),
         coalesce(j.perks->>'supplies_cap', ''),
         coalesce((j.perks->>'accessory_ok')::boolean, false),
         -- 農園紹介の文章・人柄（凍結対象外）
         ep.intro_path, ep.intro_joy, ep.intro_crops,
         ep.intro_atmosphere, ep.intro_message, ep.owner_comment,
         ep.unique_point, ep.always_do, ep.break_style, ep.interaction_style,
         -- 保険は掲載時に凍結した insurance_snapshot から（現在値への代用は禁止・2026-08-02）
         coalesce(j.insurance_snapshot->'items', '[]'::jsonb),
         coalesce(j.insurance_snapshot->'notes', '{}'::jsonb),
         -- 募集者の法定3項目＋カナも掲載時の凍結値（anonには従来どおりNULL）
         case when coalesce(auth.role(),'anon')='anon' then null::text else j.recruiter_name end,
         case when coalesce(auth.role(),'anon')='anon' then null::text else j.recruiter_address end,
         case when coalesce(auth.role(),'anon')='anon' then null::text else j.recruiter_contact end,
         case when coalesce(auth.role(),'anon')='anon' then null::text else j.recruiter_name_kana end,
         -- 関わり方の追加3問（2026-08-14・凍結対象外＝人柄グループ）
         ep.teaching_style, ep.chat_style, ep.question_style
  from jobs j
  join employer_profiles ep on ep.auth_id = j.farmer_id
  where j.job_number = p_job_number and j.status = 'open';
$function$;
revoke all on function public.job_employer_profile(integer) from public;
grant execute on function public.job_employer_profile(integer) to anon, authenticated, service_role;
