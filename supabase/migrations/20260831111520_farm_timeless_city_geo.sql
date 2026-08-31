-- 農タイムレス：リポートに「どこ」の粒度を追加（2026-08-31たきと指示「各地に散らばっているように。
-- いつどこでなにがあったか一目で理解できるように」）。
-- city＝市町村名（表示用）／lat・lng＝地図のピンの位置（おおよそでよい・任意）。
-- 既存の pref（都道府県）は不変＝面のバブル・絞り込みの単位のまま。RLS（app_admins限定）も不変。
alter table public.farm_timeless_posts
  add column if not exists city text,
  add column if not exists lat double precision,
  add column if not exists lng double precision;
