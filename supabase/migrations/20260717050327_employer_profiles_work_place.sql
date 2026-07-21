-- 農家プロフィールに作業場所（集合場所の既定値）を追加（2026-07-16）。
-- 紹介・PRボックスの差し替え先。求人フローstep3の復元ボタンがここを読む
alter table public.employer_profiles
  add column place_zip text not null default '',
  add column place_prefecture text not null default '',
  add column place_city text not null default '',
  add column place_town text not null default '',
  add column place_address text not null default '';