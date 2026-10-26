-- Activate with the frontend privacy policy v4.9-2026-10.
-- Keep account consent rows unchanged: users confirm the revised explanation themselves.
insert into public.app_settings (key,value,updated_at)
values ('privacy_version','v4.9-2026-10',now())
on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
