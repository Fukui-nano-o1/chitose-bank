-- 緊急連絡先のご登録のお願い（一斉送信・2026-08-16たきと指示）
-- 送る中身＝運営DM（admin_messages・アプリ内表示＋プッシュ通知トリガー）とメール（send_user_email・M30）。
-- 段階送信の設計：p_target を指定すると、その1人にだけ強制送信（テスト用・未入力かどうかは問わない）。
-- p_target なしで実行すると「緊急連絡先が未入力の利用者」全員に送信する（本送信）。
-- 二重送信の防止：運営DMの先頭マーカー行で判定＝テスト済み・送信済みの人には本送信で再送しない。
-- 呼び出しはバックエンド（SQL直叩き）専用＝クライアントには開かない（revoke all）。
-- 記録：運営DMの行（admin_messages）がそのまま送信の記録になる（行動記録の憲法）。

-- 1) メール番号 M30 を台帳へ（件名パターンで send_user_email が自動付与）
insert into public.mail_registry (code, subject_pattern, priority, label)
values ('M30', '緊急連絡先のご登録のお願い', 100, '緊急連絡先のご登録のお願い')
on conflict (code) do nothing;

-- 2) 送信関数
create or replace function public.admin_send_emergency_contact_reminder(p_target uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_subject text := '緊急連絡先のご登録のお願い';
  v_marker  text := '【緊急連絡先のご登録のお願い】';
  v_links   text;
  v_dm      text;
  v_mail    text;
  v_sent    int := 0;
begin
  -- 実行できるのはバックエンド（auth文脈なし＝SQL直）か運営（app_admins）のみ
  if auth.uid() is not null
     and not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  for r in
    with all_users as (
      select auth_id from public.account_holders
      union select auth_id from public.worker_profiles
      union select auth_id from public.employer_profiles
    )
    select a.auth_id,
      exists(select 1 from public.worker_profiles  w where w.auth_id = a.auth_id) as has_wp,
      exists(select 1 from public.employer_profiles p where p.auth_id = a.auth_id) as has_ep
    from all_users a
    where
      -- テスト送信：対象を明示（未入力かどうか・送信済みかどうかは問わない＝意図の明示）
      (p_target is not null and a.auth_id = p_target)
      or (
        p_target is null
        -- 未入力＝行が無い、または名前も電話も空（空欄で保存し直した人も未入力扱い）
        and not exists (
          select 1 from public.emergency_contacts e
          where e.auth_id = a.auth_id
            and (btrim(e.name) <> '' or btrim(e.phone) <> '')
        )
        -- 退会済み（匿名化メール）・停止/追放中には送らない
        and not exists (
          select 1 from auth.users u
          where u.id = a.auth_id and u.email like 'withdrawn+%'
        )
        and not public.is_account_moderated(a.auth_id)
        -- 二重送信の防止（マーカー行で判定）
        and not exists (
          select 1 from public.admin_messages m
          where m.user_id = a.auth_id and m.from_admin
            and m.body like v_marker || '%'
        )
      )
  loop
    -- 入力ページへのリンクは役割に合わせる（両方 or どちらも無ければ両方の案内）
    v_links := '';
    if r.has_wp or not r.has_ep then
      v_links := v_links || '（働き手の方）https://chitose-bank.com/#/profile/worker/profile' || E'\n';
    end if;
    if r.has_ep or not r.has_wp then
      v_links := v_links || '（農家の方）https://chitose-bank.com/#/profile/employer/profile' || E'\n';
    end if;

    v_dm := v_marker || E'\n' ||
      'もしもの事故やけがに備えて、緊急連絡先の登録をお願いしています。' || E'\n' ||
      'プロフィール編集ページの「🆘 緊急連絡先」で、お名前・あなたとの関係・電話番号を入力し、「保存する」を押してください。' || E'\n' ||
      v_links ||
      '登録した連絡先は、採用が決まった相手にだけ表示されます（求人ページや一覧には出ません）。';

    v_mail :=
      'いつもchitose-bankをご利用いただきありがとうございます。' || E'\n\n' ||
      '作業中のケガや事故など、もしもの時に備えて、緊急連絡先の登録をお願いしています。' || E'\n' ||
      '確認したところ、まだご登録がないようでしたので、お時間のあるときにご登録ください。' || E'\n\n' ||
      '■ 登録のしかた' || E'\n' ||
      'プロフィール編集ページを開き、「🆘 緊急連絡先」のボックスで' || E'\n' ||
      'お名前・あなたとの関係・電話番号を入力し、「保存する」を押してください。' || E'\n' ||
      v_links || E'\n' ||
      '■ 登録した連絡先の扱い' || E'\n' ||
      '・緊急時に連絡する先です。既定はご本人（あなた自身）で、ご家族などに変更できます' || E'\n' ||
      '・採用が決まった相手にだけ表示されます（求人ページや一覧、応募の段階では表示されません）' || E'\n' ||
      '・ご本人以外の連絡先を登録するときは、その方に伝えて同意を得たうえでご登録ください' || E'\n' ||
      '・いつでも書き換え・空欄にできます' || E'\n\n' ||
      'このメールは、緊急連絡先が未登録の方にお送りしています。';

    insert into public.admin_messages (user_id, from_admin, body)
    values (r.auth_id, true, v_dm);

    perform public.send_user_email(r.auth_id, v_subject, v_mail);
    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('ok', true, 'sent', v_sent);
end $$;

-- バックエンド専用：クライアント（anon/authenticated）からは実行不可
-- （関数作成時のPUBLIC自動付与があるため from public も必須＝2026-08-06の教訓）
revoke all on function public.admin_send_emergency_contact_reminder(uuid) from public, anon, authenticated;
