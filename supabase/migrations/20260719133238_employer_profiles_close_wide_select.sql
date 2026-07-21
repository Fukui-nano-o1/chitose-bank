-- 監査#1の締め：命綱2枚を先に張ってから、広い公開SELECTを撤去
create policy "ep owner select" on public.employer_profiles
  for select to authenticated using (auth_id = auth.uid());
create policy "ep admin select" on public.employer_profiles
  for select to authenticated
  using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));
drop policy "ep public select" on public.employer_profiles;