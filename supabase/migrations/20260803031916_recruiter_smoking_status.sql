-- 受動喫煙の状況ボックス（2026-08-03たきと指示「ありならどこか」）：
-- 就業場所の受動喫煙対策は求人の明示事項（職安法施行規則・2020年〜）。雇い手プロフィールで収集する。
-- smoking_policy＝選択（禁煙（喫煙場所なし）／喫煙場所あり・日本語ラベル保存＝transport等の既存プロフィール項目と同流儀）
-- smoking_area＝「あり」のときの場所の自由記述。表示経路への配線は別途（まず収集）。
-- consignment_profiles は EmployerProfileEdit が同じ payload を upsert するため同列を追加（LIKE複製の維持）
alter table public.employer_profiles
  add column if not exists smoking_policy text,
  add column if not exists smoking_area text;
alter table public.consignment_profiles
  add column if not exists smoking_policy text,
  add column if not exists smoking_area text;
