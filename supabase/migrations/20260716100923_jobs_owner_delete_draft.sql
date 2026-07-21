-- 農家本人による下書き(draft)の削除を許可。pending(審査中)/open(公開中)は対象外＝運営ゲート維持
create policy "jobs owner delete draft" on public.jobs
  for delete to authenticated
  using (auth.uid() = farmer_id and status = 'draft');