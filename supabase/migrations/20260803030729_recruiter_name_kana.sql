-- 雇い手プロフィール「氏名・名称」ボックスにフリガナ欄を追加（2026-08-03たきと指示）
-- 新規登録（account_holders）にカナ列は無く引き継ぎ元なし＝本人入力。表示経路は当面追加しない（収集のみ）。
-- consignment_profiles は EmployerProfileEdit が同じ payload を upsert するため同列を追加（LIKE複製の維持）
alter table public.employer_profiles
  add column if not exists recruiter_name_kana text;
alter table public.consignment_profiles
  add column if not exists recruiter_name_kana text;
