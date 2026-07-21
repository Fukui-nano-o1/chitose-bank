-- ビューの書き込み権限を剥奪（2026-07-19監査#1の検収で発見）：
-- employer_profiles_publicは単純ビュー＝自動更新可能で、書き込みはビュー所有者権限で実行される
-- ＝RLSを迂回して他人のemployer_profilesをUPDATE/DELETEできる穴だった。ビューはSELECT専用にする
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.employer_profiles_public FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.public_summary FROM anon, authenticated;
-- 公開面はログイン済みのみ（検証中仕様・jobs_publicと同方針。一般公開時にanonへgrant）
REVOKE SELECT ON public.employer_profiles_public FROM anon;