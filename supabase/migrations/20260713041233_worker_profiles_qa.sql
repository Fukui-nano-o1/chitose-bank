-- 問いかけ式Q&A：答えた問いだけが構造化されて溜まる（将来の検索・マッチングの資産）
alter table public.worker_profiles
  add column if not exists pr_qa jsonb;  -- [{"q":"q_mindset","a":"..."}]

-- 目視トリガーの変更検知に pr_qa を追加＋メールにQ&A全文を載せる
create or replace function public.trg_notify_worker_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_html text;
  v_qa_text text := '';
  v_item jsonb;
begin
  if tg_op = 'UPDATE'
     and coalesce(old.nickname,'') = coalesce(new.nickname,'')
     and coalesce(old.pr,'') = coalesce(new.pr,'')
     and coalesce(old.pr_qa,'[]'::jsonb) = coalesce(new.pr_qa,'[]'::jsonb) then
    return new;
  end if;

  if new.pr_qa is not null and jsonb_array_length(new.pr_qa) > 0 then
    for v_item in select * from jsonb_array_elements(new.pr_qa)
    loop
      v_qa_text := v_qa_text ||
        '<div style="margin-top:8px;"><div style="font-size:11px;color:#717171;">Q. '
        || coalesce(v_item->>'q','') || '</div>'
        || '<div style="font-size:13px;color:#222;white-space:pre-wrap;">'
        || coalesce(v_item->>'a','') || '</div></div>';
    end loop;
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
    || v_qa_text
    || '</div></div>';

  begin
    perform public.send_admin_email(
      '[目視] 働き手プロフィール'
        || case when tg_op = 'INSERT' then '新規：' else '更新：' end
        || coalesce(nullif(new.nickname,''),'（名前未設定）'),
      '働き手プロフィールが更新されました（HTML版参照）',
      v_html
    );
  exception when others then null;
  end;

  return new;
end;
$$;