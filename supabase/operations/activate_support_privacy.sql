-- Apply only after the v4.7-2026-09 frontend has deployed successfully.
-- save_my_privacy_consent checks this exact value; do not activate ahead of the UI.
-- This acknowledgment does not enable optional analytics or change its choice.
do $$
begin
  if not exists (
    select 1 from public.app_settings
    where key = 'privacy_version' and value in ('v4.6-2026-09', 'v4.7-2026-09')
  ) then
    raise exception 'Unexpected privacy version; do not overwrite a concurrent policy update';
  end if;
  update public.app_settings set value = 'v4.7-2026-09'
  where key = 'privacy_version' and value = 'v4.6-2026-09';
end;
$$;
