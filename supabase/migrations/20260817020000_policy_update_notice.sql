-- プライバシーポリシー・利用規約の改定のお知らせ（2026-08-17たきと指示）
--
-- 【設計】
-- ・版ごとに1回だけ送る＝policy_update_notices(auth_id, doc, version) が送信の記録。
--   次に改定した時は版が変わるので、同じ仕組みで新しく送られる（作り直さない）。
-- ・段階送信：p_target を指定するとその1人にだけ強制送信（テスト用・送信済みでも送る）。
--   p_target なしで実行すると、対象者（退会・停止中を除く全利用者）へ未送信のぶんだけ送る。
-- ・本文は引数で渡さず、この関数の中に版ごとに書く＝送った文面が後から分かる（記録の一部）。
-- ・バックエンド専用（クライアントからは実行不可）。
--
-- 【文面の方針】今回の改定は「実際に受け取っているのに一覧に書いていなかったものを書き足した」もの。
--   新しく集める情報が増えたわけではないことを最初に明示する（不安にさせない・かつ正直に）。

create table if not exists public.policy_update_notices (
  auth_id  uuid not null references auth.users(id) on delete cascade,
  doc      text not null check (doc in ('privacy','terms')),
  version  text not null,
  sent_at  timestamptz not null default now(),
  request_id bigint,
  primary key (auth_id, doc, version)
);
alter table public.policy_update_notices enable row level security;
revoke all on table public.policy_update_notices from anon, authenticated;

-- 文面の唯一のソース（送信とプレビューで共用）
create or replace function public.policy_update_mail(p_doc text, p_version text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_subject text; v_body text; v_html text; v_url text; v_items text;
begin
  if p_doc = 'privacy' then
    v_url := 'https://chitose-bank.com/#/privacy';
    v_subject := '[chitose-bank] プライバシーポリシーを改定しました';
    v_items :=
      '・プロフィールが見られた回数（ご本人と運営だけが見られます。誰が見たかは記録していません）' || E'\n' ||
      '・いいね（保存した求人）（ご本人以外は見られません。求人を出した方にも出ません）' || E'\n' ||
      '・「また呼びたい」名簿への登録（登録した求人者と、登録されたご本人だけ。ほかの求人者には出ません）' || E'\n' ||
      '・アカウントの利用停止・追放の記録（運営だけ）' || E'\n' ||
      '・退会の申し出の記録（ご本人と運営だけ）' || E'\n' ||
      '・画面の不具合が起きた時の技術的な記録（運営だけ。1年で自動的に消します）';
    v_body :=
      'いつもchitose-bankをご利用いただきありがとうございます。' || E'\n' ||
      'プライバシーポリシーを改定しましたので、お知らせします。' || E'\n\n' ||
      '■ 今回の改定でしたこと' || E'\n' ||
      '実際にお預かりしている情報のうち、これまで一覧に書いていなかったものを書き足しました。' || E'\n' ||
      '新しく集める情報が増えたわけではありません。' || E'\n\n' ||
      v_items || E'\n\n' ||
      '■ 保存期間を定めました' || E'\n' ||
      '不具合の記録は「取得から1年で削除」とし、自動で消える仕組みを入れました。' || E'\n' ||
      '閲覧履歴（30日）と同じく、期限が来たら自動的に消えます。' || E'\n\n' ||
      '■ 全文はこちら' || E'\n' || v_url || E'\n\n' ||
      '次にサイトを開いたとき、改定内容の確認が表示される場合があります。' || E'\n' ||
      'ご不明な点は、サイト内のチャット一覧にある「運営チャット」からご連絡ください。';
    v_html :=
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
      || '<h2 style="font-size:17px;color:#222;">プライバシーポリシーを改定しました</h2>'
      || '<p style="font-size:14px;color:#222;line-height:1.9;">いつもchitose-bankをご利用いただき'
      || 'ありがとうございます。プライバシーポリシーを改定しましたので、お知らせします。</p>'
      || '<h3 style="font-size:14px;color:#222;margin-top:20px;">今回の改定でしたこと</h3>'
      || '<p style="font-size:14px;color:#222;line-height:1.9;">実際にお預かりしている情報のうち、'
      || 'これまで一覧に書いていなかったものを書き足しました。<br />'
      || '<b>新しく集める情報が増えたわけではありません。</b></p>'
      || '<div style="font-size:13px;color:#222;line-height:1.9;padding:12px 16px;background:#F7F7F7;'
      || 'border-radius:10px;white-space:pre-wrap;">' || public.h(v_items) || '</div>'
      || '<h3 style="font-size:14px;color:#222;margin-top:20px;">保存期間を定めました</h3>'
      || '<p style="font-size:14px;color:#222;line-height:1.9;">不具合の記録は「取得から1年で削除」とし、'
      || '自動で消える仕組みを入れました。閲覧履歴（30日）と同じく、期限が来たら自動的に消えます。</p>'
      || '<a href="' || v_url || '" style="display:inline-block;margin-top:14px;background:#00A86B;color:#fff;'
      || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
      || 'プライバシーポリシーを読む</a>'
      || '<p style="font-size:12px;color:#717171;margin-top:16px;line-height:1.8;">'
      || '次にサイトを開いたとき、改定内容の確認が表示される場合があります。<br />'
      || 'ご不明な点は、サイト内のチャット一覧にある「運営チャット」からご連絡ください。</p>'
      || '</div>';

  elsif p_doc = 'terms' then
    v_url := 'https://chitose-bank.com/#/terms';
    v_subject := '[chitose-bank] 利用規約を改定しました';
    v_body :=
      'いつもchitose-bankをご利用いただきありがとうございます。' || E'\n' ||
      '利用規約を改定しましたので、お知らせします。' || E'\n\n' ||
      '■ 全文はこちら' || E'\n' || v_url || E'\n\n' ||
      '次にサイトを開いたとき、改定内容の確認が表示される場合があります。' || E'\n' ||
      'ご不明な点は、サイト内のチャット一覧にある「運営チャット」からご連絡ください。';
    v_html :=
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
      || '<h2 style="font-size:17px;color:#222;">利用規約を改定しました</h2>'
      || '<p style="font-size:14px;color:#222;line-height:1.9;">'
      || '利用規約を改定しましたので、お知らせします。</p>'
      || '<a href="' || v_url || '" style="display:inline-block;margin-top:14px;background:#00A86B;color:#fff;'
      || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
      || '利用規約を読む</a></div>';
  else
    return null;
  end if;

  return jsonb_build_object('subject', v_subject, 'body', v_body, 'html', v_html);
end $$;

revoke all on function public.policy_update_mail(text, text) from public, anon, authenticated;

-- 送信本体
create or replace function public.admin_send_policy_update(
  p_doc text, p_version text, p_target uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record; v_mail jsonb; v_req bigint; v_n int := 0;
begin
  if auth.uid() is not null
     and not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  v_mail := public.policy_update_mail(p_doc, p_version);
  if v_mail is null then return jsonb_build_object('ok', false, 'reason', 'bad_doc'); end if;

  for r in
    with all_users as (
      select auth_id from public.account_holders
      union select auth_id from public.worker_profiles
      union select auth_id from public.employer_profiles
    )
    select a.auth_id from all_users a
     where
       (p_target is not null and a.auth_id = p_target)
       or (
         p_target is null
         and not exists (select 1 from auth.users u
                          where u.id = a.auth_id and u.email like 'withdrawn+%')
         and not public.is_account_moderated(a.auth_id)
         and not exists (select 1 from public.policy_update_notices n
                          where n.auth_id = a.auth_id and n.doc = p_doc and n.version = p_version)
       )
  loop
    begin
      v_req := public.send_user_email(r.auth_id, v_mail->>'subject', v_mail->>'body', v_mail->>'html');
    exception when others then v_req := null; end;

    insert into public.policy_update_notices (auth_id, doc, version, request_id)
    values (r.auth_id, p_doc, p_version, v_req)
    on conflict (auth_id, doc, version) do update set sent_at = now(), request_id = excluded.request_id;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'sent', v_n, 'doc', p_doc, 'version', p_version);
end $$;

revoke all on function public.admin_send_policy_update(text, text, uuid) from public, anon, authenticated;

-- メール番号
insert into public.mail_registry (code, subject_pattern, priority, label) values
  ('M40', 'プライバシーポリシーを改定しました', 100, 'プライバシーポリシー改定のお知らせ'),
  ('M41', '利用規約を改定しました',             100, '利用規約改定のお知らせ')
on conflict (code) do nothing;
