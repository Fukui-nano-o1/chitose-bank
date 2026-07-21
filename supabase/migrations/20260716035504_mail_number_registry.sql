-- メール番号システム：恒久番号M01〜M21のレジストリ＋送信元栓での自動フッター付与。
-- 各メール関数は無変更——件名パターンで番号を解決し、全メールに説明への足票が付く。
create table if not exists public.mail_registry (
  code text primary key,            -- M01〜（恒久・再利用禁止）
  subject_pattern text not null,    -- 件名の部分一致パターン
  priority int not null default 100,-- 小さいほど先に照合（曖昧パターンの衝突回避）
  label text not null               -- 内部用の名前
);
insert into public.mail_registry (code, subject_pattern, priority, label) values
 ('M01','が公開されました',100,'求人公開のお知らせ（農家）'),
 ('M02','応募が入りました',100,'応募のお知らせ（農家）'),
 ('M03','応募が承認されました',100,'承認のお知らせ（働き手）'),
 ('M04','応募の結果について',100,'見送りのお知らせ（働き手）'),
 ('M05','応募の取り消し',100,'応募取消のお知らせ（農家）'),
 ('M06','応募の失効について',100,'応募失効のお知らせ（働き手）'),
 ('M07','応募への返答をお願いします',100,'返答のお願い（農家・前日）'),
 ('M08','保険のご準備を',100,'保険のご準備（農家・最大3回）'),
 ('M09','保険の準備が完了しました',100,'保険準備完了（働き手）'),
 ('M10','まもなく作業開始',100,'開始1時間前（双方）'),
 ('M11','遅れる連絡',90,'緊急連絡（相手方へ）'),
 ('M11a','欠勤の連絡',90,'緊急連絡・欠勤（相手方へ）'),
 ('M11b','中止の連絡',90,'緊急連絡・中止（相手方へ）'),
 ('M11c','延期の連絡',90,'緊急連絡・延期（相手方へ）'),
 ('M11d','欠勤記録への異議',90,'異議申立（相手方へ）'),
 ('M12','作業は終わりましたか',100,'完了確認（農家・朝9時）'),
 ('M13','お疲れさまでした',100,'評価のお願い（働き手）'),
 ('M14','欠勤が記録されました',100,'欠勤記録のお知らせ（働き手）'),
 ('M15','自己紹介の修正のお願い',50,'プロフィール修正依頼（働き手）'),
 ('M16','また呼びたい」と評価した農家さんの新しい求人',100,'指名リストのお知らせ（働き手）'),
 ('M17','即決で承認されました',90,'リピート即決（働き手）'),
 ('M18','リピート即決のお知らせ',90,'リピート即決（農家）'),
 ('M19','おめでとうございます！',100,'評価が届いたお知らせ（双方）'),
 ('M20','メッセージが届きました',100,'新着メッセージ（30分に1通）'),
 ('M21','の修正のお願い',200,'求人修正依頼（農家）')
on conflict (code) do update set subject_pattern = excluded.subject_pattern,
  priority = excluded.priority, label = excluded.label;

-- 送信元栓：件名から番号を解決し、フッターを自動付与（text・html両方）
create or replace function public.send_user_email(
  p_auth_id uuid, p_subject text, p_body text, p_html text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_key text; v_email text; v_payload jsonb;
  v_code text; v_body text := p_body; v_html text := p_html;
begin
  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets where name = 'RESEND_API_KEY' limit 1;
  exception when others then v_key := null;
  end;
  if v_key is null or v_key = '' then return; end if;

  select email into v_email from auth.users where id = p_auth_id;
  if v_email is null then return; end if;

  -- メール番号の解決とフッター付与
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
  exception when others then null;
  end;

  begin
    v_payload := jsonb_build_object(
      'from','chitose-bank <noreply@chitose-bank.com>',
      'to', jsonb_build_array(v_email),
      'subject', p_subject, 'text', v_body);
    if v_html is not null then
      v_payload := v_payload || jsonb_build_object('html', v_html);
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