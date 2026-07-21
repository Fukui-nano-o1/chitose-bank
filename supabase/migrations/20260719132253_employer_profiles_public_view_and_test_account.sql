-- ①監査ヒット第1号の修理準備：雇い手プロフィールの公開ビュー（安全列のみ）
-- 番地・郵便番号・確認前テキストを除外。CCが読み先を切替後、広いポリシーを撤去する
create or replace view public.employer_profiles_public as
select auth_id, nickname, pr, avatar_url,
       has_transport, has_parking, has_commute_allowance, has_bonus,
       employer_pays_supplies, accessory_ok, parking_capacity,
       commute_allowance_detail, transport_area, supplies_cap,
       intro_path, intro_joy, intro_crops, intro_atmosphere, intro_message,
       owner_comment, staff_count, commitment,
       unique_point, always_do, break_style, interaction_style,
       place_prefecture, place_city, place_town,   -- 町名まで。番地(place_address)・郵便番号は除外
       created_at
  from public.employer_profiles;
grant select on public.employer_profiles_public to authenticated;

-- ②+testアカウントを許可リストへ
insert into public.account_allowlist (email)
values ('t5fki6643qty+test@gmail.com')
on conflict do nothing;