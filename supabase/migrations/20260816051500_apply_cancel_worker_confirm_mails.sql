-- 応募・取り消しの確認メール（働き手本人宛・2026-08-16たきと指示
-- 「応募したらメール。取り消してもメール。内容は〇〇しました。〇〇の求人の応募を取り下げました。
--   時間。該当する求人詳細リンク。お問い合わせリンク。他に必要な要素。」）
--
-- 新設2通（自分の操作の控えthat手元に残る形＝行動記録の憲法と同じ思想）：
--   M28 応募の確認（働き手）＝応募した瞬間。時刻・来られる日・承認までの流れ・取り消し方・
--       応募状況リンク・求人ページリンク・ヘルプ/お問い合わせ
--   M29 応募取消の確認（働き手）＝取り消した瞬間。時刻・農家に通知済みで対応不要・再応募可・
--       求人ページリンク・さがすリンク・ヘルプ/お問い合わせ
-- 農家宛の既存メール（M02応募あり・M05応募取消）は不変。
-- 件名は番号照合（mail_registry.subject_pattern）に掛かる形で固定：
--   M28「応募しました：求人」／M29「応募を取り消しました：求人」
--   （M02「応募が入りました」・M05「応募の取り消し」とは重ならないことを確認済み）

-- 0) メール番号台帳に2行追加（send_user_email が件名照合で末尾に番号ガイドを付ける）
insert into public.mail_registry (code, subject_pattern, priority, label) values
  ('M28', '応募しました：求人', 100, '応募の確認（働き手）'),
  ('M29', '応募を取り消しました：求人', 100, '応募取消の確認（働き手）')
on conflict (code) do nothing;

-- 1) trg_notify_application：農家宛（M02・不変）に加えて、働き手本人へ応募の確認（M28）を送る。
--    トリガーに置く＝apply_to_job・仮応募の昇格（promote_my_pending_applications）の両経路で漏れなく届く。
--    ★リピート即決（instant_approve・AFTERトリガーの名前順で先に走る）で既に approved になっている場合は
--      行の実状態を読み直し、「まだ採用ではありません」でなく自動承認の説明に差し替える（M17と整合）
create or replace function public.trg_notify_application()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_nickname text; v_pr text; v_avatar text; v_pr_shown text; v_truncated boolean := false;
  v_text text; v_html text; v_ref text; v_days text := '';
  v_link text := 'https://chitose-bank.com/#/profile/employer/applicants';
  v_wref text; v_jst text; v_now_status text; v_wnote text; v_wtext text; v_whtml text;
begin
  perform public.notify_admins('new_application', '応募が入りました：求人 #' || new.job_number);
  select wp.nickname, wp.pr, wp.avatar_url into v_nickname, v_pr, v_avatar
    from public.worker_profiles wp where wp.auth_id = new.worker_id;
  v_pr := coalesce(nullif(v_pr,''), '');
  if v_pr = '' then v_pr_shown := '自己紹介は未入力です';
  elsif char_length(v_pr) <= 60 then v_pr_shown := v_pr;
  else v_pr_shown := left(v_pr, ceil(char_length(v_pr) / 2.0)::int); v_truncated := true;
  end if;
  v_ref := public.job_ref(new.job_number,'farmer');

  if new.available_dates is not null then
    if new.available_dates = '"any"'::jsonb then
      v_days := E'\n■ 来られる日：期間中いつでもOK';
    elsif jsonb_typeof(new.available_dates) = 'array'
          and jsonb_array_length(new.available_dates) > 0 then
      select E'\n■ 来られる日：' ||
             string_agg(to_char(d::date,'MM/DD'), '・' order by d::date) ||
             '（' || count(*) || '日）'
        into v_days
        from jsonb_array_elements_text(new.available_dates) d;
    end if;
  end if;

  v_text :=
    '■ ' || v_ref || ' に応募が入りました。' || E'\n\n' ||
    '■ 応募者：' || coalesce(nullif(v_nickname,''),'（名前未設定）') || v_days || E'\n' ||
    '■ 自己紹介：' || E'\n' || v_pr_shown ||
    case when v_truncated then E'…\n（続きはサイトで）' else '' end || E'\n\n' ||
    '承認・見送りはこちら：' || v_link || public.job_link(new.job_number);

  v_html :=
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
    || '<h2 style="font-size:17px;color:#222;">応募が入りました</h2>'
    || '<p style="font-size:13px;color:#717171;">' || public.h(v_ref)
    || '（' || to_char(now() at time zone 'Asia/Tokyo','MM/DD HH24:MI') || '）</p>'
    || '<div style="border:1px solid #EBEBEB;border-radius:12px;padding:16px;margin:12px 0;">'
    || case when coalesce(v_avatar,'') <> ''
         then '<img src="' || public.h(v_avatar) || '" width="56" style="width:56px;height:56px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:12px;" />'
         else '' end
    || '<span style="font-size:16px;font-weight:bold;color:#222;vertical-align:middle;">'
    || public.h(coalesce(nullif(v_nickname,''),'（名前未設定）')) || '</span>'
    || case when v_days <> '' then
         '<div style="font-size:13px;color:#00794D;font-weight:bold;margin-top:8px;">'
         || public.h(replace(v_days, E'\n', '')) || '</div>' else '' end
    || '<div style="font-size:13px;color:#222;white-space:pre-wrap;margin-top:10px;padding:10px 14px;background:#F7F7F7;border-radius:8px;">'
    || public.h(v_pr_shown)
    || case when v_truncated
         then '… <a href="' || v_link || '" style="color:#00A86B;font-weight:bold;text-decoration:none;">もっと見る</a>'
         else '' end
    || '</div></div>'
    || '<a href="' || v_link || '" style="display:inline-block;background:#00A86B;color:#fff;'
    || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
    || '承認・見送りのページを開く</a>'
    || '<p style="font-size:11px;color:#B0B0B0;margin-top:14px;">'
    || 'chitose-bankは場の提供のみを行い、採否には関与しません。</p></div>';

  begin
    perform public.send_user_email(new.farmer_id,
      '[chitose-bank] 応募が入りました：あなたの求人 #' || new.job_number, v_text, v_html);
  exception when others then null; end;

  -- ── 働き手本人への応募の確認（M28・2026-08-16新設） ──────────────────
  begin
    -- リピート即決（AFTERトリガー instant_approve that名前順で先に走り行をUPDATE済み）に追従：
    -- NEWレコードでなく行の実状態を読み直す
    select a.status into v_now_status from public.applications a where a.id = new.id;
    v_wref := public.job_ref(new.job_number, 'worker');
    v_jst := to_char(now() at time zone 'Asia/Tokyo', 'MM/DD HH24:MI');
    v_wnote := case when v_now_status = 'approved'
      then 'リピート即決の設定により、応募は自動で承認されました（まだ採用ではありません）。チャットで打ち合わせに進めます。'
      else 'まだ採用ではありません。農家が内容を確認し、承認するとお知らせが届きます（作業日の前日までに、必ず結果が届きます）。' end;
    v_wtext :=
      '■ ' || v_wref || E'\n\n' ||
      'この求人に応募しました（' || v_jst || '）。' || E'\n' ||
      v_wnote || v_days || E'\n' ||
      '承認前なら、応募状況のページからいつでも取り消せます。' || E'\n\n' ||
      '応募状況を見る：https://chitose-bank.com/#/profile/worker/applying' ||
      public.job_link(new.job_number) || E'\n\n' ||
      '困ったときは：' || E'\n' ||
      '・ヘルプ：https://chitose-bank.com/#/help' || E'\n' ||
      '・お問い合わせ：t5fki6643qty@gmail.com';
    v_whtml :=
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
      || '<h2 style="font-size:17px;color:#222;">応募しました</h2>'
      || '<p style="font-size:13px;color:#717171;">' || public.h(v_wref)
      || '（' || v_jst || '）</p>'
      || '<p style="font-size:13px;color:#222;line-height:1.9;margin:12px 0;">' || public.h(v_wnote) || '</p>'
      || case when v_days <> '' then
           '<p style="font-size:13px;color:#00794D;font-weight:bold;margin:0 0 12px;">'
           || public.h(replace(v_days, E'\n', '')) || '</p>' else '' end
      || '<p style="font-size:12px;color:#717171;margin:0 0 16px;">承認前なら、応募状況のページからいつでも取り消せます。</p>'
      || '<a href="https://chitose-bank.com/#/profile/worker/applying" style="display:inline-block;background:#00A86B;color:#fff;'
      || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">応募状況を見る</a>'
      || '<p style="font-size:13px;margin:16px 0 0;"><a href="https://chitose-bank.com/#/work/job/' || new.job_number
      || '" style="color:#00A86B;text-decoration:underline;font-weight:700;">求人ページを見る</a></p>'
      || '<p style="font-size:11px;color:#B0B0B0;margin-top:16px;">困ったときは　'
      || '<a href="https://chitose-bank.com/#/help" style="color:#B0B0B0;text-decoration:underline;">ヘルプ</a>'
      || '　／　お問い合わせ：<a href="mailto:t5fki6643qty@gmail.com" style="color:#B0B0B0;text-decoration:underline;">t5fki6643qty@gmail.com</a></p>'
      || '<p style="font-size:11px;color:#B0B0B0;">chitose-bankは場の提供のみを行い、採否には関与しません。</p></div>';
    perform public.send_user_email(new.worker_id,
      '[chitose-bank] 応募しました：求人 #' || new.job_number, v_wtext, v_whtml);
  exception when others then null; end;
  return new;
end; $function$;

-- 2) cancel_application：農家宛（M05・不変）に加えて、働き手本人へ取り消しの確認（M29）を送る
create or replace function public.cancel_application(p_application_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_worker uuid; v_farmer uuid; v_status text; v_job int; v_name text;
  v_wref text; v_jst text; v_wtext text; v_whtml text;
begin
  select worker_id, farmer_id, status, job_number into v_worker, v_farmer, v_status, v_job
    from public.applications where id = p_application_id;
  if v_worker is null then return json_build_object('ok', false, 'reason','not_found'); end if;
  if v_worker <> auth.uid() then return json_build_object('ok', false, 'reason','not_yours'); end if;
  if v_status = 'canceled' then return json_build_object('ok', true, 'already', true); end if;
  if v_status <> 'applied' then
    return json_build_object('ok', false, 'reason','already_decided', 'status', v_status);
  end if;
  update public.applications
     set status = 'canceled', canceled_at = now()
   where id = p_application_id;
  begin
    insert into public.messages (application_id, sender_id, body)
    values (p_application_id, v_worker, '応募を取り消しました。');
  exception when others then null; end;
  v_name := public.resolve_actor_name(v_worker);
  insert into public.notifications (farmer_id, type, message)
  values (v_farmer, 'application_cancelled',
          '応募が取り消されました：求人 #' || v_job || '　' || v_name || 'さん');
  begin
    perform public.send_user_email(v_farmer,
      '[chitose-bank] 応募の取り消し：求人 #' || v_job,
      '■ ' || public.job_ref(v_job,'farmer') || E'\n\n' ||
      v_name || 'さんが応募を取り消しました。' || E'\n' ||
      '（承認前の取り消しのため、対応は不要です）' || public.job_link(v_job));
  exception when others then null; end;

  -- ── 働き手本人への取り消しの確認（M29・2026-08-16新設） ──────────────
  begin
    v_wref := public.job_ref(v_job, 'worker');
    v_jst := to_char(now() at time zone 'Asia/Tokyo', 'MM/DD HH24:MI');
    v_wtext :=
      '■ ' || v_wref || E'\n\n' ||
      'この求人への応募を取り下げました（' || v_jst || '）。' || E'\n' ||
      '農家にもお知らせ済みです。あなたからの対応は不要です。' || E'\n' ||
      '募集が続いていれば、同じ求人にもう一度応募することもできます。' ||
      public.job_link(v_job) || E'\n\n' ||
      '他の求人をさがす：https://chitose-bank.com/#/search' || E'\n\n' ||
      '困ったときは：' || E'\n' ||
      '・ヘルプ：https://chitose-bank.com/#/help' || E'\n' ||
      '・お問い合わせ：t5fki6643qty@gmail.com';
    v_whtml :=
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
      || '<h2 style="font-size:17px;color:#222;">応募を取り消しました</h2>'
      || '<p style="font-size:13px;color:#717171;">' || public.h(v_wref)
      || '（' || v_jst || '）</p>'
      || '<p style="font-size:13px;color:#222;line-height:1.9;margin:12px 0;">'
      || 'この求人への応募を取り下げました。農家にもお知らせ済みです。あなたからの対応は不要です。<br>'
      || '募集が続いていれば、同じ求人にもう一度応募することもできます。</p>'
      || '<p style="font-size:13px;margin:0 0 8px;"><a href="https://chitose-bank.com/#/work/job/' || v_job
      || '" style="color:#00A86B;text-decoration:underline;font-weight:700;">求人ページを見る</a></p>'
      || '<a href="https://chitose-bank.com/#/search" style="display:inline-block;background:#00A86B;color:#fff;'
      || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;margin-top:8px;">他の求人をさがす</a>'
      || '<p style="font-size:11px;color:#B0B0B0;margin-top:16px;">困ったときは　'
      || '<a href="https://chitose-bank.com/#/help" style="color:#B0B0B0;text-decoration:underline;">ヘルプ</a>'
      || '　／　お問い合わせ：<a href="mailto:t5fki6643qty@gmail.com" style="color:#B0B0B0;text-decoration:underline;">t5fki6643qty@gmail.com</a></p></div>';
    perform public.send_user_email(v_worker,
      '[chitose-bank] 応募を取り消しました：求人 #' || v_job, v_wtext, v_whtml);
  exception when others then null; end;

  return json_build_object('ok', true);
end; $function$;
