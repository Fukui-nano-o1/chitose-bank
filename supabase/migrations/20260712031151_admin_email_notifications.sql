-- 非同期HTTPを有効化（トリガーからメールAPIを叩くため）
create extension if not exists pg_net with schema extensions;

-- 管理者へメールを送る。
-- ⚠️ 設計上の絶対条件：メール送信に失敗しても、呼び出し元（新規登録など）を失敗させない。
--    通知は落ちてよい。登録は落ちてはならない。
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
  -- Vault から Resend の APIキーを取得。未設定ならメールは送らず、静かに終わる。
  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets
     where name = 'RESEND_API_KEY'
     limit 1;
  exception when others then
    v_key := null;
  end;

  if v_key is null or v_key = '' then
    return;  -- キー未設定。メールなし。登録は正常に続行される。
  end if;

  -- app_admins に登録された管理者の、認証済みメールアドレス宛に送る。
  -- 管理者を増やすときは app_admins に1行入れるだけでよい（ハードコードしない）。
  for v_email in
    select u.email
      from public.app_admins a
      join auth.users u on u.id = a.auth_id
     where u.email is not null
  loop
    begin
      perform net.http_post(
        url     := 'https://api.resend.com/emails',
        headers := jsonb_build_object(
                     'Authorization', 'Bearer ' || v_key,
                     'Content-Type',  'application/json'
                   ),
        body    := jsonb_build_object(
                     'from',    'chitose-bank <onboarding@resend.dev>',
                     'to',      jsonb_build_array(v_email),
                     'subject', p_subject,
                     'text',    p_body
                   ),
        timeout_milliseconds := 3000
      );
    exception when others then
      -- 送信失敗は握りつぶす。呼び出し元（新規登録）を絶対に巻き込まない。
      null;
    end;
  end loop;
end;
$$;

-- 既存の notify_admins に、メール送信を追加する。
-- アプリ内通知（従来どおり）＋メール（新規）の両方が飛ぶ。
create or replace function public.notify_admins(p_type text, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (farmer_id, type, message)
  select a.auth_id, p_type, p_message
    from public.app_admins a;

  -- メール送信は失敗しても呼び出し元を止めない（send_admin_email 内で握りつぶし済み）
  begin
    perform public.send_admin_email('[chitose-bank] ' || p_message, p_message);
  exception when others then
    null;
  end;
end;
$$;