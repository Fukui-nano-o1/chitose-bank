-- 規約・プラポリのお知らせメール：件名の頭を【重要】に、表記を「改訂」に（2026-08-17たきと指示）
--
-- 1. 件名の頭 '[chitose-bank] ' → '【重要】'
--    このメールだけの扱い（他のメールは従来どおり [chitose-bank] のまま）。
--    受信箱で他の通知に埋もれさせないため。
-- 2. 「改定」→「改訂」に統一（件名・本文・HTML）。
-- ★件名が変わるので mail_registry の照合パターンも同時に直す
--   （直さないとメール番号 M40/M41 が付かなくなる）。

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
    v_subject := '【重要】プライバシーポリシーを改訂しました';
    v_items :=
      '・プロフィールが見られた回数（ご本人と運営だけが見られます。誰が見たかは記録していません）' || E'\n' ||
      '・いいね（保存した求人）（ご本人以外は見られません。求人を出した方にも出ません）' || E'\n' ||
      '・「また呼びたい」名簿への登録（登録した求人者と、登録されたご本人だけ。ほかの求人者には出ません）' || E'\n' ||
      '・アカウントの利用停止・追放の記録（運営だけ）' || E'\n' ||
      '・退会の申し出の記録（ご本人と運営だけ）' || E'\n' ||
      '・画面の不具合が起きた時の技術的な記録（運営だけ。1年で自動的に消します）';
    v_body :=
      'いつもchitose-bankをご利用いただきありがとうございます。' || E'\n' ||
      'プライバシーポリシーを改訂しましたので、お知らせします。' || E'\n\n' ||
      '■ 今回の改訂でしたこと' || E'\n' ||
      '実際にお預かりしている情報のうち、これまで一覧に書いていなかったものを書き足しました。' || E'\n' ||
      '新しく集める情報が増えたわけではありません。' || E'\n\n' ||
      v_items || E'\n\n' ||
      '■ 保存期間を定めました' || E'\n' ||
      '不具合の記録は「取得から1年で削除」とし、自動で消える仕組みを入れました。' || E'\n' ||
      '閲覧履歴（30日）と同じく、期限が来たら自動的に消えます。' || E'\n\n' ||
      '■ 全文はこちら' || E'\n' || v_url || E'\n\n' ||
      '次にサイトを開いたとき、改訂内容の確認が表示される場合があります。' || E'\n' ||
      'ご不明な点は、サイト内のチャット一覧にある「運営チャット」からご連絡ください。';
    v_html :=
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
      || '<h2 style="font-size:17px;color:#222;">プライバシーポリシーを改訂しました</h2>'
      || '<p style="font-size:14px;color:#222;line-height:1.9;">いつもchitose-bankをご利用いただき'
      || 'ありがとうございます。プライバシーポリシーを改訂しましたので、お知らせします。</p>'
      || '<h3 style="font-size:14px;color:#222;margin-top:20px;">今回の改訂でしたこと</h3>'
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
      || '次にサイトを開いたとき、改訂内容の確認が表示される場合があります。<br />'
      || 'ご不明な点は、サイト内のチャット一覧にある「運営チャット」からご連絡ください。</p>'
      || '</div>';

  elsif p_doc = 'terms' then
    v_url := 'https://chitose-bank.com/#/terms';
    v_subject := '【重要】利用規約を改訂しました';
    v_body :=
      'いつもchitose-bankをご利用いただきありがとうございます。' || E'\n' ||
      '利用規約を改訂しましたので、お知らせします。' || E'\n\n' ||
      '■ 全文はこちら' || E'\n' || v_url || E'\n\n' ||
      '次にサイトを開いたとき、改訂内容の確認が表示される場合があります。' || E'\n' ||
      'ご不明な点は、サイト内のチャット一覧にある「運営チャット」からご連絡ください。';
    v_html :=
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
      || '<h2 style="font-size:17px;color:#222;">利用規約を改訂しました</h2>'
      || '<p style="font-size:14px;color:#222;line-height:1.9;">'
      || '利用規約を改訂しましたので、お知らせします。</p>'
      || '<a href="' || v_url || '" style="display:inline-block;margin-top:14px;background:#00A86B;color:#fff;'
      || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
      || '利用規約を読む</a></div>';
  else
    return null;
  end if;

  return jsonb_build_object('subject', v_subject, 'body', v_body, 'html', v_html);
end $$;

revoke all on function public.policy_update_mail(text, text) from public, anon, authenticated;

-- 件名が変わったので照合パターンも差し替え（メール番号が付かなくなるのを防ぐ）
update public.mail_registry
   set subject_pattern = 'プライバシーポリシーを改訂しました',
       label = 'プライバシーポリシー改訂のお知らせ'
 where code = 'M40';
update public.mail_registry
   set subject_pattern = '利用規約を改訂しました',
       label = '利用規約改訂のお知らせ'
 where code = 'M41';
