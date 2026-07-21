-- 保存できないバグ修正（2026-07-18）：jobs owner insert draft の本人確認が旧farmers行必須のままで、
-- 現行の登録経路（account_holders＋employer_profiles・farmers行を作らない）の農家がINSERTで弾かれていた。
-- 修正：farmers行 または account_holders行（①登録済みの本人）のどちらかでよい。
-- 法務境界は不変：INSERTはstatus draft/pendingのみ（保存=適法）・掲載(open)はjobs admin writeのみ。
DROP POLICY IF EXISTS "jobs owner insert draft" ON public.jobs;
CREATE POLICY "jobs owner insert draft" ON public.jobs FOR INSERT
  WITH CHECK (
    (auth.uid() = farmer_id)
    AND (status = ANY (ARRAY['draft'::text, 'pending'::text]))
    AND (
      EXISTS (SELECT 1 FROM farmers f WHERE f.auth_id = auth.uid())
      OR EXISTS (SELECT 1 FROM account_holders ah WHERE ah.auth_id = auth.uid())
    )
  );