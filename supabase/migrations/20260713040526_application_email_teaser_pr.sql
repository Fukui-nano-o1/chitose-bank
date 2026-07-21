-- 応募メールの自己紹介を「半分＋…もっと見る」に変更（本編はサイトへ誘導）。
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
  v_pr_shown text;
  v_truncated boolean := false;
  v_text text;
  v_html text;
  v_link text := 'https://chitose-bank.com/#/profile/employer/applicants';
begin
  perform public.notify_admins('new_application', '応募が入りました：求人 #' || new.job_number);

  select wp.nickname, wp.pr, wp.avatar_url into v_nickname, v_pr, v_avatar
    from public.worker_profiles wp where wp.auth_id = new.worker_id;
  select j.crop, j.task into v_crop, v_task
    from public.jobs j where j.job_number = new.job_number;

  -- 自己紹介：60字以下は全文、それ以上は半分で切って「…もっと見る」
  v_pr := coalesce(nullif(v_pr,''), '');
  if v_pr = '' then
    v_pr_shown := '自己紹介は未入力です';
  elsif char_length(v_pr) <= 60 then
    v_pr_shown := v_pr;
  else
    v_pr_shown := left(v_pr, ceil(char_length(v_pr) / 2.0)::int);
    v_truncated := true;
  end if;

  v_text :=
    'あなたの求人 #' || new.job_number ||
      '（' || coalesce(v_crop,'') || ' ' || coalesce(v_task,'') || '）に応募が入りました。' || E'\n\n' ||
    '■ 応募者：' || coalesce(nullif(v_nickname,''),'（名前未設定）') || E'\n' ||
    '■ 自己紹介：' || E'\n' || v_pr_shown ||
    case when v_truncated then E'…\n（続きはサイトで）' else '' end || E'\n\n' ||
    '承認・見送りはこちら：' || v_link;

  v_html :=
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
    || '<h2 style="font-size:17px;color:#222;">応募が入りました</h2>'
    || '<p style="font-size:13px;color:#717171;">求人 #' || new.job_number
    || '　' || coalesce(v_crop,'') || ' ' || coalesce(v_task,'')
    || '（' || to_char(now() at time zone 'Asia/Tokyo','MM/DD HH24:MI') || '）</p>'
    || '<div style="border:1px solid #EBEBEB;border-radius:12px;padding:16px;margin:12px 0;">'
    || case when coalesce(v_avatar,'') <> ''
         then '<img src="' || v_avatar || '" width="56" style="width:56px;height:56px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:12px;" />'
         else '' end
    || '<span style="font-size:16px;font-weight:bold;color:#222;vertical-align:middle;">'
    || coalesce(nullif(v_nickname,''),'（名前未設定）') || '</span>'
    || '<div style="font-size:13px;color:#222;white-space:pre-wrap;margin-top:10px;padding:10px 14px;background:#F7F7F7;border-radius:8px;">'
    || v_pr_shown
    || case when v_truncated
         then '… <a href="' || v_link || '" style="color:#00A86B;font-weight:bold;text-decoration:none;">もっと見る</a>'
         else '' end
    || '</div></div>'
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