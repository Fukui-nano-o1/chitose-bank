-- 本人宛の取引メール。相手方の連絡先・氏名は一切含めない（職安法ゲート：連絡先交換に該当させない）。
-- 送信失敗は握りつぶす。応募INSERT・承認UPDATEを絶対に巻き込まない。
create or replace function public.send_user_email(p_auth_id uuid, p_subject text, p_body text)
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
  exception when others then v_key := null;
  end;
  if v_key is null or v_key = '' then return; end if;

  select email into v_email from auth.users where id = p_auth_id;
  if v_email is null then return; end if;

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
end;
$$;

-- ① 応募が入ったら、その求人の農家本人へメール（管理者通知は従来どおり別途）
create or replace function public.trg_notify_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_admins('new_application', '応募が入りました：求人 #' || new.job_number);

  begin
    perform public.send_user_email(
      new.farmer_id,
      '[chitose-bank] 応募が入りました：求人 #' || new.job_number,
      'あなたの求人 #' || new.job_number || ' に応募が入りました。' || E'\n' ||
      'ログインして「応募者」タブからご確認ください。' || E'\n\n' ||
      'https://chitose-bank.com'
    );
  exception when others then null;
  end;

  return new;
end;
$$;

-- ② 承認されたら、働き手本人へメール（アプリ内通知は従来どおり）
create or replace function public.approve_application(p_application_id uuid, p_approve boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid; v_farmer uuid; v_worker uuid; v_status text; v_job int; v_new text;
begin
  v_caller := auth.uid();
  if v_caller is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;

  select farmer_id, worker_id, status, job_number
    into v_farmer, v_worker, v_status, v_job
    from public.applications where id = p_application_id;

  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_farmer <> v_caller then return json_build_object('ok', false, 'reason', 'not_your_application'); end if;
  if v_status <> 'applied' then return json_build_object('ok', false, 'reason', 'already_decided', 'status', v_status); end if;

  v_new := case when p_approve then 'approved' else 'rejected' end;
  update public.applications set status = v_new where id = p_application_id;

  if p_approve then
    insert into public.notifications (farmer_id, type, message)
    values (v_worker, 'application_approved',
            '応募が承認されました：求人 #' || v_job || '　日程などのご連絡をお待ちください');

    begin
      perform public.send_user_email(
        v_worker,
        '[chitose-bank] 応募が承認されました：求人 #' || v_job,
        '求人 #' || v_job || ' への応募が承認されました。' || E'\n' ||
        '日程などのご連絡をお待ちください。' || E'\n\n' ||
        'https://chitose-bank.com'
      );
    exception when others then null;
    end;
  end if;

  return json_build_object('ok', true, 'status', v_new);
end;
$$;