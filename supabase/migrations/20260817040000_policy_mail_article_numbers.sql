-- 改訂のお知らせに「第何条を直したか」を明記する（2026-08-17たきと指示）
--
-- 【なぜ】どこが変わったのか分からないお知らせは、読んだ人が全文を最初から読み直すことになる。
--   条番号と表題を先に置き、その条の中で何を足したかを並べる。
--
-- 【今回の中身（実物と照合済み）】
--   プラポリ v3.9：第3条 個人情報の取り扱い一覧・データ台帳 に5項目を追記（v3.8のエラーの記録と合わせて6項目）。
--     保存期間もこの第3条の表の「保存期間」欄に書いてある。ほかの条は変えていない。
--   規約 v2.4：第14条（規約の変更）を民法548条の4に沿った3項に全面差し替え。
--     第7条3（欠勤への異議）に「確認した内容は記録として保存します」を追記。

create or replace function public.policy_update_mail(p_doc text, p_version text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_subject text; v_body text; v_html text; v_url text; v_items text; v_arts text;
begin
  if p_doc = 'privacy' then
    v_url := 'https://chitose-bank.com/#/privacy';
    v_subject := '【重要】プライバシーポリシーを改訂しました';
    v_arts := '第3条（個人情報の取り扱い一覧・データ台帳）';
    v_items :=
      '・プロフィールが閲覧された回数（ご本人と運営だけが見られます。誰が見たかは記録していません）' || E'\n' ||
      '・いいね（保存した求人）（ご本人以外は見られません。求人を出した方にも出ません）' || E'\n' ||
      '・「また呼びたい」名簿への登録（登録した求人者と、登録されたご本人だけ。ほかの求人者には出ません）' || E'\n' ||
      '・アカウントの利用停止・追放の記録（運営だけ）' || E'\n' ||
      '・退会の申し出の記録（ご本人と運営だけ）' || E'\n' ||
      '・画面の不具合が起きた時の技術的な記録（運営だけ）';
    v_body :=
      'いつもchitose-bankをご利用いただきありがとうございます。' || E'\n' ||
      'プライバシーポリシーを改訂しましたので、お知らせします。' || E'\n\n' ||
      '■ 改訂した条文' || E'\n' ||
      v_arts || E'\n' ||
      '※ほかの条文は変えていません。' || E'\n\n' ||
      '■ 第3条の表に書き足した項目' || E'\n' ||
      '実際にお預かりしている情報のうち、これまで一覧に書いていなかったものを書き足しました。' || E'\n' ||
      '新しく集める情報が増えたわけではありません。' || E'\n\n' ||
      v_items || E'\n\n' ||
      '■ 第3条の表の「保存期間」欄に定めたこと' || E'\n' ||
      '不具合の記録は「取得から1年で削除」とし、自動で消える仕組みを入れました。' || E'\n' ||
      '閲覧履歴（30日）と同じく、期限が来たら自動的に消えます。' || E'\n\n' ||
      '■ 全文はこちら（ページ上部の目次から第3条へ進めます）' || E'\n' || v_url || E'\n\n' ||
      '次にサイトを開いたとき、改訂内容の確認が表示される場合があります。' || E'\n' ||
      'ご不明な点は、サイト内のチャット一覧にある「運営チャット」からご連絡ください。';
    v_html :=
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
      || '<h2 style="font-size:17px;color:#222;">プライバシーポリシーを改訂しました</h2>'
      || '<p style="font-size:14px;color:#222;line-height:1.9;">いつもchitose-bankをご利用いただき'
      || 'ありがとうございます。プライバシーポリシーを改訂しましたので、お知らせします。</p>'
      || '<h3 style="font-size:14px;color:#222;margin-top:20px;">改訂した条文</h3>'
      || '<p style="font-size:14px;color:#222;line-height:1.9;margin:0;"><b>' || public.h(v_arts) || '</b><br />'
      || '<span style="font-size:12px;color:#717171;">※ほかの条文は変えていません。</span></p>'
      || '<h3 style="font-size:14px;color:#222;margin-top:20px;">第3条の表に書き足した項目</h3>'
      || '<p style="font-size:14px;color:#222;line-height:1.9;">実際にお預かりしている情報のうち、'
      || 'これまで一覧に書いていなかったものを書き足しました。<br />'
      || '<b>新しく集める情報が増えたわけではありません。</b></p>'
      || '<div style="font-size:13px;color:#222;line-height:1.9;padding:12px 16px;background:#F7F7F7;'
      || 'border-radius:10px;white-space:pre-wrap;">' || public.h(v_items) || '</div>'
      || '<h3 style="font-size:14px;color:#222;margin-top:20px;">第3条の表の「保存期間」欄に定めたこと</h3>'
      || '<p style="font-size:14px;color:#222;line-height:1.9;">不具合の記録は「取得から1年で削除」とし、'
      || '自動で消える仕組みを入れました。閲覧履歴（30日）と同じく、期限が来たら自動的に消えます。</p>'
      || '<a href="' || v_url || '" style="display:inline-block;margin-top:14px;background:#00A86B;color:#fff;'
      || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
      || 'プライバシーポリシーを読む</a>'
      || '<p style="font-size:12px;color:#717171;margin-top:8px;">ページ上部の目次から第3条へ進めます。</p>'
      || '<p style="font-size:12px;color:#717171;margin-top:16px;line-height:1.8;">'
      || '次にサイトを開いたとき、改訂内容の確認が表示される場合があります。<br />'
      || 'ご不明な点は、サイト内のチャット一覧にある「運営チャット」からご連絡ください。</p>'
      || '</div>';

  elsif p_doc = 'terms' then
    v_url := 'https://chitose-bank.com/#/terms';
    v_subject := '【重要】利用規約を改訂しました';
    v_arts := '第14条（規約の変更）／第7条3（欠勤の記録への異議）';
    v_items :=
      '・第14条（規約の変更）' || E'\n' ||
      '　規約を変更できる場合と、変更をお知らせする方法を、法令（民法第548条の4）に沿って書き直しました。' || E'\n' ||
      '　変更後の規約がいつから適用されるか（効力発生日）を定めて事前にお知らせします。' || E'\n' ||
      '　利用者の権利を制限する重要な変更は、あらかじめ余裕をもってお知らせします。' || E'\n\n' ||
      '・第7条3（欠勤の記録への異議）' || E'\n' ||
      '　異議があった場合に運営が双方から確認した内容を、記録として保存することを明記しました。';
    v_body :=
      'いつもchitose-bankをご利用いただきありがとうございます。' || E'\n' ||
      '利用規約を改訂しましたので、お知らせします。' || E'\n\n' ||
      '■ 改訂した条文' || E'\n' ||
      v_arts || E'\n' ||
      '※ほかの条文は変えていません。' || E'\n\n' ||
      '■ 変えた内容' || E'\n' ||
      v_items || E'\n\n' ||
      '■ 全文はこちら（ページ上部の目次から各条へ進めます）' || E'\n' || v_url || E'\n\n' ||
      '次にサイトを開いたとき、改訂内容の確認が表示される場合があります。' || E'\n' ||
      'ご不明な点は、サイト内のチャット一覧にある「運営チャット」からご連絡ください。';
    v_html :=
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
      || '<h2 style="font-size:17px;color:#222;">利用規約を改訂しました</h2>'
      || '<p style="font-size:14px;color:#222;line-height:1.9;">'
      || '利用規約を改訂しましたので、お知らせします。</p>'
      || '<h3 style="font-size:14px;color:#222;margin-top:20px;">改訂した条文</h3>'
      || '<p style="font-size:14px;color:#222;line-height:1.9;margin:0;"><b>' || public.h(v_arts) || '</b><br />'
      || '<span style="font-size:12px;color:#717171;">※ほかの条文は変えていません。</span></p>'
      || '<h3 style="font-size:14px;color:#222;margin-top:20px;">変えた内容</h3>'
      || '<div style="font-size:13px;color:#222;line-height:1.9;padding:12px 16px;background:#F7F7F7;'
      || 'border-radius:10px;white-space:pre-wrap;">' || public.h(v_items) || '</div>'
      || '<a href="' || v_url || '" style="display:inline-block;margin-top:14px;background:#00A86B;color:#fff;'
      || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
      || '利用規約を読む</a>'
      || '<p style="font-size:12px;color:#717171;margin-top:8px;">ページ上部の目次から各条へ進めます。</p>'
      || '<p style="font-size:12px;color:#717171;margin-top:16px;line-height:1.8;">'
      || '次にサイトを開いたとき、改訂内容の確認が表示される場合があります。<br />'
      || 'ご不明な点は、サイト内のチャット一覧にある「運営チャット」からご連絡ください。</p>'
      || '</div>';
  else
    return null;
  end if;

  return jsonb_build_object('subject', v_subject, 'body', v_body, 'html', v_html);
end $$;

revoke all on function public.policy_update_mail(text, text) from public, anon, authenticated;
