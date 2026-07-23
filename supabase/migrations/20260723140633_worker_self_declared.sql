-- 働き手の「できること・資格（自己申告）」（2026-07-23）。
-- ※本番へ先行適用済み（supabase_migrations に version 20260723140633 として記録済み）。
--   本ファイルは repo とのズレを解消するための写経（二頭運転の交通規則）。冪等形なので再適用も安全。
-- 免許・資格・保険方針などを key配列で保存（license_car/license_special/forklift/brush_cutter/machinery/self_insurance）。
-- あくまで本人の自己申告（運営は確認しない）。身体属性に関する項目は追加しない（CLAUDE.mdルール）。
alter table public.worker_profiles add column if not exists self_declared jsonb not null default '[]'::jsonb;
