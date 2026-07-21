-- 働き手プロフィールの構造化：承認判断（来れるか・できるか）に直結する項目を追加。
-- 全て任意・タップ選択式。自由記述は増やさない（読まれない・検索できない）。
alter table public.worker_profiles
  add column if not exists residence_city text,          -- 居住地（市区町村まで・番地なし）
  add column if not exists transport text,               -- 移動手段: car/bike/bicycle/public
  add column if not exists farm_experience text,         -- 経験: none/helper/1year+/farmer
  add column if not exists experienced_tasks jsonb,      -- 経験作業: ["収穫","選果","草刈り","支柱",...]
  add column if not exists physical_level text;          -- 体力: light/normal/heavy

comment on column public.worker_profiles.residence_city is '市区町村まで。番地は保持しない（3層情報設計）';