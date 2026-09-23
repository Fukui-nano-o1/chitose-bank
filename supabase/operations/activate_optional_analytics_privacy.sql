-- Apply AFTER the matching frontend has deployed. This policy acknowledgment
-- never grants optional analytics permission; the separate opt-in remains OFF.
do $$
begin
  if not exists (select 1 from public.app_settings where key = 'privacy_version' and value in ('v4.5-2026-08','v4.6-2026-09')) then
    raise exception 'Unexpected privacy version; do not overwrite a concurrent policy update';
  end if;
  update public.app_settings set value = 'v4.6-2026-09'
  where key = 'privacy_version' and value = 'v4.5-2026-08';
end;
$$;
