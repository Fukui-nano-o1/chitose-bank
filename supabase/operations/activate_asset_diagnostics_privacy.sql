-- Apply only AFTER the v4.9 frontend is live; verify the value afterward.
-- No schema/permission changes. Do not overwrite another policy revision.
do $$
begin
  if not exists (select 1 from public.app_settings where key = 'privacy_version'
                 and value in ('v4.8-2026-09', 'v4.9-2026-10')) then
    raise exception 'Unexpected privacy version; inspect the concurrent policy update';
  end if;
  update public.app_settings set value = 'v4.9-2026-10'
  where key = 'privacy_version' and value = 'v4.8-2026-09';
end;
$$;
