-- メール送信の元栓をResend→Brevoへ切替（鍵名BREVO_API_KEY・API v3形式）
create or replace function public.send_admin_email(p_subject text, p_body text, p_html text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_key text; v_email text; v_payload jsonb;
begin
  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets where name = 'BREVO_API_KEY' limit 1;
  exception when others then v_key := null; end;
  if v_key is null or v_key = '' then return; end if;

  for v_email in
    select u.email from public.app_admins a
    join auth.users u on u.id = a.auth_id where u.email is not null
  loop
    begin
      v_payload := jsonb_build_object(
        'sender', jsonb_build_object('name','chitose-bank','email','noreply@chitose-bank.com'),
        'to', jsonb_build_array(jsonb_build_object('email', v_email)),
        'subject', p_subject, 'textContent', p_body);
      if p_html is not null then
        v_payload := v_payload || jsonb_build_object('htmlContent', p_html);
      end if;
      perform net.http_post(
        url := 'https://api.brevo.com/v3/smtp/email',
        headers := jsonb_build_object('api-key', v_key, 'Content-Type','application/json'),
        body := v_payload, timeout_milliseconds := 3000);
    exception when others then null; end;
  end loop;
end; $$;

create or replace function public.send_user_email(p_auth_id uuid, p_subject text, p_body text, p_html text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_key text; v_email text; v_payload jsonb;
  v_code text; v_body text := p_body; v_html text := p_html;
begin
  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets where name = 'BREVO_API_KEY' limit 1;
  exception when others then v_key := null; end;
  if v_key is null or v_key = '' then return; end if;

  select email into v_email from auth.users where id = p_auth_id;
  if v_email is null then return; end if;

  begin
    select left(code, 3) into v_code
      from public.mail_registry
     where p_subject like '%' || subject_pattern || '%'
     order by priority, code limit 1;
    if v_code is not null then
      v_body := v_body || E'\n\n―――\n' ||
        'このメールの番号：' || v_code ||
        '（使い方ガイドの「届くメール一覧」で説明しています）' || E'\n' ||
        'https://chitose-bank.com/#/help/mails';
      if v_html is not null then
        v_html := v_html ||
          '<p style="font-size:11px;color:#B0B0B0;border-top:1px solid #EBEBEB;'
          || 'margin-top:16px;padding-top:10px;">このメールの番号：' || v_code
          || '　<a href="https://chitose-bank.com/#/help/mails" style="color:#B0B0B0;">'
          || '使い方ガイドの「届くメール一覧」で説明しています</a></p>';
      end if;
    end if;
  exception when others then null; end;

  begin
    v_payload := jsonb_build_object(
      'sender', jsonb_build_object('name','chitose-bank','email','noreply@chitose-bank.com'),
      'to', jsonb_build_array(jsonb_build_object('email', v_email)),
      'subject', p_subject, 'textContent', v_body);
    if v_html is not null then
      v_payload := v_payload || jsonb_build_object('htmlContent', v_html);
    end if;
    perform net.http_post(
      url := 'https://api.brevo.com/v3/smtp/email',
      headers := jsonb_build_object('api-key', v_key, 'Content-Type','application/json'),
      body := v_payload, timeout_milliseconds := 3000);
  exception when others then null; end;
end; $$;