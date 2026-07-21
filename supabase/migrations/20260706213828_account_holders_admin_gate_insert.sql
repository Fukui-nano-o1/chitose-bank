DROP POLICY IF EXISTS "own_insert" ON public.account_holders;
CREATE POLICY "own_insert" ON public.account_holders
  FOR INSERT
  WITH CHECK (
    (auth.uid() = auth_id)
    AND ((auth.jwt() ->> 'email') = 't5fki6643qty@gmail.com')
  );