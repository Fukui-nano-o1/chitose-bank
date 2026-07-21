-- 持ち物の農家負担に上限設定を追加（2026-07-16）。例：「上限1,000円まで」「軍手・長靴のみ」
alter table public.employer_profiles add column supplies_cap text not null default '';