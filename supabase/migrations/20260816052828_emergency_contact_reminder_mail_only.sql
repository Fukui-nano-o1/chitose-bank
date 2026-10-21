-- 緊急連絡先のご登録のお願い v2（2026-08-16たきと指示「チャットの記録を管理者に送信する必要はない」）
-- 変更点（20260816070000 からの差し替え）：
-- 1) 運営DM（admin_messages）への書き込みを廃止＝メール（M30）のみ送る
-- 2) 送信の記録と二重送信防止は notifications（type='emergency_contact_reminder'）の行で行う
--    （行動記録の憲法：送った事実は記録に残す。チャットには載せない）
-- 3) メール本文にアプリ利用者向けの開き方を追記：
--    iPhoneではメールのリンクはSafariで開き、ホーム画面アプリには遷移できない（iOSの仕様）ため、
--    アプリの方への手順（プロフィール→名前カード）を先に案内する。
--    リンクは未ログインでも、ログイン後に元のページへ自動で戻る（armLoginReturn/afterLoginGo・2026-07-30）

create or replace function public.admin_send_emergency_contact_reminder(p_target uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_subject text := '緊急連絡先のご登録のお願い';
  v_links   text;
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
        -- 二重送信の防止（送信記録＝notificationsの行で判定）
        and not exists (
          select 1 from public.notifications n
          where n.farmer_id = a.auth_id and n.type = 'emergency_contact_reminder'
        )
      )
  loop
    -- ブラウザ用リンクは役割に合わせる（両方 or どちらも無ければ両方の案内）
    v_links := '';
    if r.has_wp or not r.has_ep then
      v_links := v_links || '（働き手の方）https://chitose-bank.com/#/profile/worker/profile' || E'\n';
    end if;
    if r.has_ep or not r.has_wp then
      v_links := v_links || '（農家の方）https://chitose-bank.com/#/profile/employer/profile' || E'\n';
    end if;

    v_mail :=
      'いつもchitose-bankをご利用いただきありがとうございます。' || E'\n\n' ||
      '作業中のケガや事故など、もしもの時に備えて、緊急連絡先の登録をお願いしています。' || E'\n' ||
      '確認したところ、まだご登録がないようでしたので、お時間のあるときにご登録ください。' || E'\n\n' ||
      '■ 登録のしかた' || E'\n' ||
      'プロフィール編集ページの「🆘 緊急連絡先」のボックスで、' || E'\n' ||
      'お名前・あなたとの関係・電話番号を入力し、「保存する」を押してください。' || E'\n\n' ||
      '・ホーム画面のアプリをお使いの方：アプリを開き、画面下の「プロフィール」→ いちばん上の名前カードをタップ' || E'\n' ||
      '・ブラウザの方：次のリンクから開けます（ログイン画面が出た場合は、ログインすると自動で元のページに戻ります）' || E'\n' ||
      v_links || E'\n' ||
      '■ 登録した連絡先の扱い' || E'\n' ||
      '・緊急時に連絡する先です。既定はご本人（あなた自身）で、ご家族などに変更できます' || E'\n' ||
      '・採用が決まった相手にだけ表示されます（求人ページや一覧、応募の段階では表示されません）' || E'\n' ||
      '・ご本人以外の連絡先を登録するときは、その方に伝えて同意を得たうえでご登録ください' || E'\n' ||
      '・いつでも書き換え・空欄にできます' || E'\n\n' ||
      'このメールは、緊急連絡先が未登録の方にお送りしています。';

    -- 送信の記録（＝二重送信防止の判定材料。チャットには載せない）
    insert into public.notifications (farmer_id, type, message)
    values (r.auth_id, 'emergency_contact_reminder', '緊急連絡先のご登録のお願い（M30）をメールで送信');

    perform public.send_user_email(r.auth_id, v_subject, v_mail);
    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('ok', true, 'sent', v_sent);
end $$;

-- バックエンド専用（v1と同じ・関数再作成でPUBLIC付与が復活するため再宣言）
revoke all on function public.admin_send_emergency_contact_reminder(uuid) from public, anon, authenticated;
