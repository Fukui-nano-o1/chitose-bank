-- 働き手プロフィールの事後目視：作成/更新のたびに管理者へ全文メール。
-- 審査対象は適法性と安全のみ（連絡先直書き・個人特定・不適切表現）。
-- 文章の質・熱意は審査しない（求職者の選別＝職安法の線に触れるため）。
create or replace function public.trg_notify_worker_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_html text;
begin
  -- 内容が実質変わっていない更新は鳴らさない
  if tg_op = 'UPDATE'
     and coalesce(old.nickname,'') = coalesce(new.nickname,'')
     and coalesce(old.pr,'') = coalesce(new.pr,'') then
    return new;
  end if;

  v_html :=
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
    || '<h2 style="font-size:16px;color:#222;">働き手プロフィールの'
    || case when tg_op = 'INSERT' then '新規作成' else '更新' end || '</h2>'
    || '<p style="font-size:12px;color:#717171;">目視観点：連絡先の直書き／個人特定情報の書きすぎ／不適切表現のみ。'
    || '文章の質・熱意は審査しない（求職者の選別に当たるため）。</p>'
    || '<div style="border:1px solid #EBEBEB;border-radius:12px;padding:16px;margin:12px 0;">'
    || case when coalesce(new.avatar_url,'') <> ''
         then '<img src="' || new.avatar_url || '" width="56" style="width:56px;height:56px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:12px;" />'
         else '' end
    || '<span style="font-size:16px;font-weight:bold;">'
    || coalesce(nullif(new.nickname,''),'（名前未設定）') || '</span>'
    || '<div style="font-size:13px;white-space:pre-wrap;margin-top:10px;padding:10px 14px;background:#F7F7F7;border-radius:8px;">'
    || coalesce(nullif(new.pr,''),'（自己紹介なし）') || '</div>'
    || '</div></div>';

  begin
    perform public.send_admin_email(
      '[目視] 働き手プロフィール'
        || case when tg_op = 'INSERT' then '新規：' else '更新：' end
        || coalesce(nullif(new.nickname,''),'（名前未設定）'),
      '働き手プロフィールが' || case when tg_op = 'INSERT' then '作成' else '更新' end
        || 'されました。' || E'\n名前：' || coalesce(nullif(new.nickname,''),'（名前未設定)')
        || E'\n自己紹介：' || E'\n' || coalesce(nullif(new.pr,''),'（なし）'),
      v_html
    );
  exception when others then null;
  end;

  return new;
end;
$$;

drop trigger if exists notify_worker_profile on public.worker_profiles;
create trigger notify_worker_profile
  after insert or update on public.worker_profiles
  for each row execute function public.trg_notify_worker_profile();