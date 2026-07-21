-- workers テーブルの執行。
-- 証明済み：0行・参照FK 0・依存ビュー 0・触る関数 0・コード参照 0（grep確認 2026-07-12）。
-- 認証は account_holders 一本化（2c9a7dd/ac4f15f）、働き手の実体は worker_profiles が正。
drop table if exists public.workers;