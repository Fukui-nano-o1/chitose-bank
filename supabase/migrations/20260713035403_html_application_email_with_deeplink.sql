-- 応募メールのHTML化＋承認ページへの直行ボタン。
-- 原則維持：応募者の連絡先は含めない（チャットへ誘導）。開示はニックネーム・自己紹介・アバターまで
--（RLSで農家に既に開示済みの範囲と同一）。

-- send_user_email に html 引数を追加（既存2引数呼び出しはデフォルトで互換）
drop function if exists public.send_user_email(uuid, text, text);
create or replace function public.send_user_email(p_auth_id uuid, p_subject text, p_body text, p_html text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_email text;
  v_payload jsonb;
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
    v_payload := jsonb_build_object(
      'from','chitose-bank <noreply@chitose-bank.com>',
      'to', jsonb_build_array(v_email),
      'subject', p_subject, 'text', p_body);
    if p_html is not null then
      v_payload := v_payload || jsonb_build_object('html', p_html);
    end if;
    perform net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization','Bearer '||v_key,'Content-Type','application/json'),
      body    := v_payload,
      timeout_milliseconds := 3000
    );
  exception when others then null;
  end;
end;
$$;

-- 応募トリガー：HTML本文＋「承認・見送りへ」直行ボタン
create or replace function public.trg_notify_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nickname text;
  v_pr text;
  v_avatar text;
  v_crop text;
  v_task text;
  v_text text;
  v_html text;
  v_link text := 'https://chitose-bank.com/#/profile/employer/applicants';
begin
  perform public.notify_admins('new_application', '応募が入りました：求人 #' || new.job_number);

  select wp.nickname, wp.pr, wp.avatar_url into v_nickname, v_pr, v_avatar
    from public.worker_profiles wp where wp.auth_id = new.worker_id;
  select j.crop, j.task into v_crop, v_task
    from public.jobs j where j.job_number = new.job_number;

  v_text :=
    'あなたの求人 #' || new.job_number ||
      '（' || coalesce(v_crop,'') || ' ' || coalesce(v_task,'') || '）に応募が入りました。' || E'\n\n' ||
    '■ 応募者：' || coalesce(nullif(v_nickname,''),'（名前未設定）') || E'\n' ||
    '■ 自己紹介：' || E'\n' || coalesce(nullif(v_pr,''),'ー') || E'\n\n' ||
    '承認・見送りはこちら：' || v_link;

  v_html :=
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
    || '<h2 style="font-size:17px;color:#222;">応募が入りました</h2>'
    || '<p style="font-size:13px;color:#717171;">求人 #' || new.job_number
    || '　' || coalesce(v_crop,'') || ' ' || coalesce(v_task,'')
    || '（' || to_char(now() at time zone 'Asia/Tokyo','MM/DD HH24:MI') || '）</p>'

    -- 応募者カード
    || '<div style="border:1px solid #EBEBEB;border-radius:12px;padding:16px;margin:12px 0;">'
    || case when coalesce(v_avatar,'') <> ''
         then '<img src="' || v_avatar || '" width="56" style="width:56px;height:56px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:12px;" />'
         else '' end
    || '<span style="font-size:16px;font-weight:bold;color:#222;vertical-align:middle;">'
    || coalesce(nullif(v_nickname,''),'（名前未設定）') || '</span>'
    || '<div style="font-size:13px;color:#222;white-space:pre-wrap;margin-top:10px;padding:10px 14px;background:#F7F7F7;border-radius:8px;">'
    || coalesce(nullif(v_pr,''),'自己紹介は未入力です') || '</div>'
    || '</div>'

    || '<a href="' || v_link || '" style="display:inline-block;background:#00A86B;color:#fff;'
    || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
    || '承認・見送りのページを開く</a>'
    || '<p style="font-size:11px;color:#B0B0B0;margin-top:14px;">'
    || '承認すると、応募者にお知らせが届き、チャットで日程を打ち合わせられます。<br/>'
    || 'chitose-bankは場の提供のみを行い、採否には関与しません。</p>'
    || '</div>';

  begin
    perform public.send_user_email(
      new.farmer_id,
      '[chitose-bank] 応募が入りました：求人 #' || new.job_number || '　'
        || coalesce(nullif(v_nickname,''),'（名前未設定）') || 'さん',
      v_text, v_html
    );
  exception when others then null;
  end;

  return new;
end;
$$;