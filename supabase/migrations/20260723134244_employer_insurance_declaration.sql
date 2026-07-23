-- 農家プロフィール「保険の準備」宣言（自己申告・2026-07-23）。
-- ※本番へ先行適用済み（supabase_migrations に version 20260723134244 として記録済み）。
--   本ファイルは repo とのズレを解消するための写経（二頭運転の交通規則・2026-07-21）。冪等形なので再適用も安全。
-- 保険の種類を jsonb 配列で保存（day_accident/annual_accident/rosai/facility/vehicle/considering）。
-- あくまで農家の自己申告（運営は証書を確認しない）。employer_profiles_public に列を足し、雇い手プレビュー等で閲覧できるようにする。
alter table public.employer_profiles add column if not exists insurance_items jsonb not null default '[]'::jsonb;

create or replace view public.employer_profiles_public as
 select auth_id, nickname, pr, avatar_url, has_transport, has_parking, has_commute_allowance,
   has_bonus, employer_pays_supplies, accessory_ok, parking_capacity, commute_allowance_detail,
   transport_area, supplies_cap, intro_path, intro_joy, intro_crops, intro_atmosphere,
   intro_message, owner_comment, staff_count, commitment, unique_point, always_do, break_style,
   interaction_style, place_prefecture, place_city, place_town, created_at, insurance_items
 from public.employer_profiles;

-- ビューはSELECT専用にする（2026-07-19ルール）：単純ビューは自動更新可能で、書き込みが
-- ビュー所有者権限で走り基表のRLSを迂回しうる。書き込み権限を剥がし、閲覧のみ許可する。
revoke all on public.employer_profiles_public from anon, authenticated;
grant select on public.employer_profiles_public to authenticated;
