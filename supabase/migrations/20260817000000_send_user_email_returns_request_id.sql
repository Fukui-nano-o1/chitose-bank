-- send_user_email が送信リクエストID（pg_net）を返すようにする（2026-08-17）
--
-- 目的：メールが「送った」だけでなく「相手のメールサーバーに受理された」ことを記録できるようにする。
--   pg_net は非同期なので、送信した瞬間には結果that分からない。返ってくるIDを控えておけば、
--   後から net._http_response と突き合わせて、受理の時刻と応答コードを記録できる。
--
-- 【互換性】呼び出し元31本はすべて perform（返り値を使わない）so影響なし。
--   返り値の型を変えるため create or replace ではなく drop→create する。
--   ★drop→create すると default privileges で anon/authenticated に EXECUTE that戻るため、
--     作成後に必ず revoke し直す（2026-08-06の教訓：revoke は from public と from anon の両方that要る）。
--
-- 【返り値】送信を投げた時のリクエストID／送らなかった時（自分宛の抑止・鍵なし・宛先なし）は null。

drop function if exists public.send_user_email(uuid, text, text, text);

create function public.send_user_email(p_auth_id uuid, p_subject text, p_body text, p_html text default null)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key text; v_email text; v_payload jsonb;
  v_code text; v_body text := p_body; v_html text := p_html; v_mute boolean;
  v_req bigint;
begin
  select value = 'true' into v_mute from public.app_settings where key = 'self_mail_mute';
  if coalesce(v_mute, false) and not public.is_measured(p_auth_id) then return null; end if;

  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets where name = 'BREVO_API_KEY' limit 1;
  exception when others then v_key := null; end;
  if v_key is null or v_key = '' then return null; end if;
  select email into v_email from auth.users where id = p_auth_id;
  if v_email is null then return null; end if;

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
    v_req := net.http_post(
      url := 'https://api.brevo.com/v3/smtp/email',
      headers := jsonb_build_object('api-key', v_key, 'Content-Type','application/json'),
      body := v_payload, timeout_milliseconds := 3000);
  exception when others then v_req := null; end;

  return v_req;
end; $function$;

-- クライアントからは叩けないまま維持（2026-08-06 の裏方revoke）
revoke all on function public.send_user_email(uuid, text, text, text) from public, anon, authenticated;
