-- 働き手ニックネーム正規化の穴（2026-08-07 10パターン実弾テストP4で発見）：
-- 旧式 lower(normalize(btrim(x), NFKC)) は btrim（半角空白しか削れない）が先のため、
-- 末尾の全角空白(U+3000)が生き残り、NFKCで半角空白に変わって「はなこ 」≠「はなこ」＝重複が通った。
-- 修理＝NFKC正規化を先・btrimを後（全角空白→半角空白→btrimで除去）。
create or replace function public.wp_nickname_norm(p text)
returns text language sql immutable
as $$ select lower(btrim(normalize(coalesce(p,''), NFKC))) $$;
