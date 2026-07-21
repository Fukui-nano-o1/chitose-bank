-- chitose-bank.com はResendでVerified済み。仮の onboarding@resend.dev をやめ、独自ドメインから送る。
create or replace function public.send_admin_email(p_subject text, p_body text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_email text;
begin
  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets where name = 'RESEND_API_KEY' limit 1;
  exception when others then
    v_key := null;
  end;
  if v_key is null or v_key = '' then return; end if;

  for v_email in
    select u.email from public.app_admins a
    join auth.users u on u.id = a.auth_id
    where u.email is not null
  loop
    begin
      perform net.http_post(
        url     := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization','Bearer '||v_key,'Content-Type','application/json'),
        body    := jsonb_build_object(
          'from','chitose-bank <noreply@chitose-bank.com>',
          'to', jsonb_build_array(v_email),
          'subject', p_subject, 'text', p_body),
        timeout_milliseconds := 3000
      );
    exception when others then null;
    end;
  end loop;
end;
$$;

select public.send_admin_email('[chitose-bank] 送信元テスト','noreply@chitose-bank.com からの送信確認です。');