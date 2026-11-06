-- Catalog-only definitions inspected 2026-11-05. No user records or credentials.
CREATE OR REPLACE FUNCTION public.trg_instant_approve()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_instant boolean; v_want boolean;
begin
  if new.status <> 'applied' then return new; end if;
  select instant_approve_repeat into v_instant from public.jobs where job_number = new.job_number;
  if not coalesce(v_instant, false) then return new; end if;
  select exists (
    select 1 from public.repeat_roster rr
     where rr.farmer_id = new.farmer_id and rr.worker_id = new.worker_id
  ) into v_want;
  if not v_want then return new; end if;

  update public.applications set status = 'approved', decided_at = now() where id = new.id;

  insert into public.notifications (farmer_id, type, message) values
    (new.worker_id, 'application_approved',
     '🌟即決で承認されました：求人 #' || new.job_number || '　（承認は採用ではありません。打ち合わせのあとに決まります）'),
    (new.farmer_id, 'application_approved',
     '🌟リピート即決：以前「また呼びたい」と評価した方の応募を自動承認しました（求人 #' || new.job_number || '・採用の決定はチャットで）');
  begin
    perform public.send_user_email(new.worker_id,
      '[chitose-bank] 🌟即決で承認されました：求人 #' || new.job_number,
      '■ ' || public.job_ref(new.job_number,'worker') || E'\n\n' ||
      '応募が、即決で承認されました。' || E'\n' ||
      'この求人者から以前「また呼びたい」の評価を受けているため、選考なしで承認されています。' || E'\n' ||
      '（承認は採用ではありません。採用は打ち合わせ・面接のあとに決まります）' || E'\n\n' ||
      'チャットで日程を確認しましょう：https://chitose-bank.com/#/chats' ||
      public.job_link(new.job_number));
    perform public.send_user_email(new.farmer_id,
      '[chitose-bank] 🌟リピート即決のお知らせ：求人 #' || new.job_number,
      '■ ' || public.job_ref(new.job_number,'farmer') || E'\n\n' ||
      'あなたが以前「また呼びたい」と評価した方から応募があり、' || E'\n' ||
      '求人の設定に基づいて自動承認しました。' || E'\n' ||
      '（承認は採用ではありません。チャットで打ち合わせのうえ「採用する」で決定してください）' || E'\n\n' ||
      '応募者の確認：https://chitose-bank.com/#/profile/employer/applicants' ||
      public.job_link(new.job_number));
  exception when others then null; end;
  return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.trg_notify_application()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    '応募者のプロフィールをご確認のうえ、承認・見送り等をご自身でご判断ください。' || E'\n' ||
    'サイト外で連絡した場合も、対応状況を更新してください。' || E'

' ||
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
    || '<p style="font-size:12px;color:#717171;margin-top:14px;line-height:1.8;">'
    || '応募者のプロフィールをご確認のうえ、承認・見送り等をご自身でご判断ください。<br />'
    || 'サイト外で連絡した場合も、対応状況を更新してください。</p>'
    || '<p style="font-size:11px;color:#B0B0B0;margin-top:14px;">'
    || 'chitose-bankは場の提供のみを行い、採否には関与しません。</p></div>';

  begin
    perform public.send_user_email(new.farmer_id,
      '[chitose-bank] 応募が入りました：あなたの求人 #' || new.job_number, v_text, v_html);
  exception when others then null; end;

  begin
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
end; $function$
;
CREATE OR REPLACE FUNCTION public.trg_notify_roster()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; v_instant text;
begin
  if new.status <> 'open' or coalesce(old.status,'') = 'open' then return new; end if;
  v_instant := case when coalesce(new.instant_approve_repeat, false)
    then E'\nこの求人は、応募すると選考なしで即決になります。' else '' end;
  for r in
    select worker_id from public.repeat_roster
     where farmer_id = new.farmer_id and notify = true and worker_id <> new.farmer_id
  loop
    insert into public.notifications (farmer_id, type, message)
    values (r.worker_id, 'roster_new_job',
            '🌟あなたを「また呼びたい」と評価した農家さんの新しい求人：#' || new.job_number);
    begin
      perform public.send_user_email(r.worker_id,
        '[chitose-bank] 🌟あなたを「また呼びたい」と評価した農家さんの新しい求人です',
        '■ ' || public.job_ref(new.job_number,'worker') || v_instant || E'\n\n' ||
        '今すぐチェック：https://chitose-bank.com/#/work/job/' || new.job_number);
    exception when others then null; end;
  end loop;
  return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.apply_to_job(p_job_number integer, p_available_dates jsonb DEFAULT NULL::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_worker_id uuid; v_farmer_id uuid; v_status text; v_app_id uuid;
  v_date_start date; v_date_end date; v_is_period boolean; v_avail jsonb;
begin
  v_worker_id := auth.uid();
  if v_worker_id is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  if public.is_account_moderated(v_worker_id) then
    return json_build_object('ok', false, 'reason', 'account_suspended');
  end if;

  select farmer_id, status, date_start, date_end into v_farmer_id, v_status, v_date_start, v_date_end from public.jobs where job_number = p_job_number;
  if v_farmer_id is null then return json_build_object('ok', false, 'reason', 'job_not_found'); end if;
  if v_status <> 'open' then return json_build_object('ok', false, 'reason', 'job_not_open'); end if;
  -- 求人者(農家)が停止・追放中なら、その求人は募集終了として扱う（2026-08-16）
  if public.is_account_moderated(v_farmer_id) then return json_build_object('ok', false, 'reason', 'job_not_open'); end if;
  if v_farmer_id = v_worker_id then return json_build_object('ok', false, 'reason', 'own_job'); end if;

  -- 期間求人（date_end有り・単日でない）は「来られる日」の宣言が必須。単日求人は null で従来どおり
  v_is_period := v_date_end is not null and v_date_end <> v_date_start;
  if v_is_period then
    if p_available_dates is null
       or not (p_available_dates = '"any"'::jsonb
               or (jsonb_typeof(p_available_dates) = 'array' and jsonb_array_length(p_available_dates) > 0)) then
      return json_build_object('ok', false, 'reason', 'dates_required');
    end if;
    v_avail := p_available_dates;
  else
    v_avail := null;
  end if;

  -- ★(a) 自由記述の審査待ち（pr_pending）では応募を止めない。未承認の本文は農家に見えない
  --   （worker_profile_for_farmer が under_review を返す）＝公開はしていない。審査を応募の関所にしない。

  -- 本人情報の登録（18歳確認・規約同意の記録）が無いまま応募を届けない（2026-08-17 段B・段C）
  if not exists (select 1 from public.account_holders h where h.auth_id = v_worker_id) then
    return json_build_object('ok', false, 'reason', 'not_registered');
  end if;

  -- ★(b) プロフィールの条件は is_worker_profile_ready（4項目）1本＝仮応募・昇格と同じ物差し（2026-08-17 段C）
  if exists (select 1 from public.app_settings where key = 'apply_profile_gate' and value = 'true') then
    if not public.is_worker_profile_ready(v_worker_id) then
      return json_build_object('ok', false, 'reason', 'profile_incomplete');
    end if;
  end if;

  insert into public.applications (job_number, worker_id, farmer_id, status, available_dates)
  values (p_job_number, v_worker_id, v_farmer_id, 'applied', v_avail)
  on conflict (job_number, worker_id) where status <> 'canceled' do nothing
  returning id into v_app_id;
  if v_app_id is null then return json_build_object('ok', true, 'already', true); end if;

  begin
    insert into public.messages (application_id, sender_id, body)
    values (v_app_id, v_worker_id, 'あなたの求人に応募しました！プロフィールの確認をお願いします。');
    if exists (select 1 from public.applications a where a.id = v_app_id and a.status = 'approved') then
      insert into public.messages (application_id, sender_id, body)
      values (v_app_id, v_farmer_id, '🌟リピート即決の設定により、応募を自動で承認しました（採用ではありません）。チャットで打ち合わせを進めましょう。');
    end if;
  exception when others then null; end;

  return json_build_object('ok', true, 'application_id', v_app_id);
end; $function$
;
