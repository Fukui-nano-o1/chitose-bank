-- ============================================================================
-- ★★ このファイルの apply_to_job は【古い定義】です。土台にしないでください ★★
--   ここに書かれた apply_to_job は「ニックネーム＋Q&A回答1件以上」を要求する旧ゲートを
--   含んでいます。2026-08-17の段C（20260817100956_apply_gate_single_condition）で、
--   応募の条件は is_worker_profile_ready（4項目）に一本化されました。
--   create or replace なので、このファイルを再実行したり、ここの本文をコピーして
--   新しい migration を書くと、段Cが【無言で】巻き戻ります（エラーは出ません）。
--   症状＝正面の応募は弾かれるのに、仮応募からの昇格だけ通る（条件が割れる）。
--
--   現行の正：apply_to_job = 20260817100956 ／ is_worker_profile_ready = 20260817100444
--   新しく apply_to_job を触るときは、必ず本番の現定義を土台にすること
--   （select pg_get_functiondef(oid) from pg_proc where proname='apply_to_job'）。
--   巻き戻りは supabase/checks/audit.sql の検査⑦が検出します。
-- ============================================================================
-- 応募時の来られる日宣言（2026-07-24）＝二頭運転の同期写経。
--   applications.available_dates（jsonb）と M02通知トリガー trg_notify_application の available_dates 表示は
--   別端末が本番へ先行適用済み。ここで repo に写経して同期する（冪等形ので再適用も安全）。
--   apply_to_job への p_available_dates 追加は本セッションで適用（下記）。
-- 値の形：期間求人＝ "any"（期間中いつでもOK）または ["YYYY-MM-DD", ...]（特定日・複数可）／単日求人＝null。

-- 1) 列（先行適用済み・冪等）
alter table public.applications add column if not exists available_dates jsonb;

-- 2) M02通知トリガー（先行適用済みの本番定義を写経）：応募通知に「来られる日」を掲載
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
  return new;
end; $function$;

-- 3) apply_to_job：期間求人は available_dates 必須（"any" or 日付配列）。単日は null。本セッションで適用。
drop function if exists public.apply_to_job(integer);
create or replace function public.apply_to_job(p_job_number integer, p_available_dates jsonb default null)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_worker_id uuid; v_farmer_id uuid; v_status text; v_app_id uuid;
  v_nickname text; v_qa_count int := 0; v_under_review boolean; v_revision boolean;
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

  select (coalesce(btrim(wp.pr_pending),'') <> ''
          or jsonb_array_length(coalesce(wp.pr_qa_pending,'[]'::jsonb)) > 0),
         wp.pr_submitted_at is null
    into v_under_review, v_revision
    from public.worker_profiles wp where wp.auth_id = v_worker_id;
  if coalesce(v_under_review, false) then
    return json_build_object('ok', false, 'reason', 'profile_under_review', 'revision', coalesce(v_revision, false));
  end if;

  if exists (select 1 from public.app_settings where key = 'apply_profile_gate' and value = 'true') then
    select wp.nickname,
           coalesce((select count(*) from jsonb_array_elements(coalesce(wp.pr_qa,'[]'::jsonb)) e
                      where btrim(coalesce(e->>'a','')) <> ''), 0)
      into v_nickname, v_qa_count
      from public.worker_profiles wp where wp.auth_id = v_worker_id;
    if coalesce(btrim(v_nickname),'') = '' or v_qa_count < 5 then
      return json_build_object('ok', false, 'reason', 'profile_incomplete',
        'has_nickname', coalesce(btrim(v_nickname),'') <> '', 'qa_answered', v_qa_count, 'qa_required', 5);
    end if;
  end if;

  insert into public.applications (job_number, worker_id, farmer_id, status, available_dates)
  values (p_job_number, v_worker_id, v_farmer_id, 'applied', v_avail)
  on conflict (job_number, worker_id) do nothing
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
end; $function$;
grant execute on function public.apply_to_job(integer, jsonb) to authenticated;
