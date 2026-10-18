-- Observed production trigger definitions, 2026-10-18; test DB only.
CREATE OR REPLACE FUNCTION public.trg_enrich_terms_snapshot_party()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_worker text; v_farmer text;
begin
  if old.terms_snapshot is null and new.terms_snapshot is not null
     and not (new.terms_snapshot ? 'party_names') then
    select nullif(btrim(full_name),'') into v_worker from public.account_holders where auth_id = new.worker_id;
    select nullif(btrim(full_name),'') into v_farmer from public.account_holders where auth_id = new.farmer_id;
    new.terms_snapshot := new.terms_snapshot || jsonb_build_object(
      'party_names', jsonb_build_object('worker', v_worker, 'farmer', v_farmer));
  end if;
  return new;
end; $function$;
CREATE TRIGGER enrich_terms_snapshot_party BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION trg_enrich_terms_snapshot_party();
CREATE OR REPLACE FUNCTION public.trg_protect_terms_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.terms_snapshot is not null then
      raise exception '契約記録（凍結済みスナップショット）のある応募は削除できません';
    end if;
    return old;
  end if;
  if old.terms_snapshot is not null then
    if new.terms_snapshot is distinct from old.terms_snapshot
       or new.terms_confirmed_worker_at is distinct from old.terms_confirmed_worker_at
       or new.terms_confirmed_farmer_at is distinct from old.terms_confirmed_farmer_at then
      raise exception '凍結済みの契約記録は変更できません（全経路で不変）';
    end if;
  end if;
  return new;
end; $function$;
CREATE TRIGGER protect_terms_snapshot BEFORE DELETE OR UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION trg_protect_terms_snapshot();
CREATE OR REPLACE FUNCTION public.assert_actor_not_moderated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and public.is_account_moderated(auth.uid()) then
    raise exception 'アカウントは停止中のため、この操作はできません。運営（t5fki6643qty@gmail.com）までご連絡ください。'
      using errcode = 'P0001';
  end if;
  return new;
end; $function$;
CREATE TRIGGER trg_a_block_moderated BEFORE INSERT OR UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION assert_actor_not_moderated();
CREATE OR REPLACE FUNCTION public.stamp_worker_terms_on_apply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.terms_confirmed_worker_at := coalesce(new.terms_confirmed_worker_at, now());
  return new;
end; $function$;
CREATE TRIGGER trg_stamp_worker_terms_on_apply BEFORE INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION stamp_worker_terms_on_apply();
CREATE OR REPLACE FUNCTION public.trg_notify_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_worker uuid; v_farmer uuid; v_job int; v_recipient uuid;
  v_link text; v_viewer text; v_ref text; v_name text; v_sent text;
  v_contact text; v_footer_text text; v_footer_html text;
begin
  select worker_id, farmer_id, job_number into v_worker, v_farmer, v_job
    from public.applications where id = new.application_id;
  if v_worker is null then return new; end if;
  v_recipient := case when new.sender_id = v_farmer then v_worker else v_farmer end;

  v_link := 'https://chitose-bank.com/#/chat/' || new.application_id;
  v_contact := 'https://chitose-bank.com/#/chats'; -- お問い合わせ＝チャット一覧（運営チャットの入口）
  v_viewer := case when v_recipient = v_farmer then 'farmer' else 'worker' end;
  v_ref := public.job_ref(v_job, v_viewer);

  -- 送信者の表示名（役割で解決・20260814082846と同じ）
  if new.sender_id = v_farmer then
    select coalesce(
      (select nullif(btrim(nickname), '') from public.employer_profiles where auth_id = new.sender_id),
      public.resolve_actor_name(new.sender_id)) into v_name;
  else
    v_name := public.resolve_actor_name(new.sender_id);
  end if;
  v_sent := to_char(new.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI');

  insert into public.notifications (farmer_id, type, message)
  values (v_recipient, 'new_message',
          'メッセージが届きました：求人 #' || v_job || '　' || left(new.body, 20));

  v_footer_text := E'\n\n―――\n' ||
    'このメールの番号：M20（使い方ガイドの「届くメール一覧」で説明しています）' || E'\n' ||
    'https://chitose-bank.com/#/help/mails';
  v_footer_html := '<p style="font-size:11px;color:#B0B0B0;border-top:1px solid #EBEBEB;'
    || 'margin-top:16px;padding-top:10px;">このメールの番号：M20'
    || '　<a href="https://chitose-bank.com/#/help/mails" style="color:#B0B0B0;">'
    || '使い方ガイドの「届くメール一覧」で説明しています</a></p>';

  begin
    perform public.chat_message_mail_send(v_recipient,
      v_name,
      v_name || 'さんからメッセージが届きました。' || E'\n' ||
      '■ ' || v_ref || E'\n\n' ||
      '【メッセージ全文】' || E'\n' ||
      new.body || E'\n\n' ||
      '送信日時：' || v_sent || '（日本時間）' || E'\n\n' ||
      '▼ このチャットを開いて返信する' || E'\n' || v_link || E'\n\n' ||
      '▼ お問い合わせ（チャット一覧の「運営チャット」からご連絡ください）' || E'\n' || v_contact ||
      v_footer_text,
      '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
      || '<h2 style="font-size:16px;color:#222;">' || public.h(v_name) || 'さんからメッセージが届きました</h2>'
      || '<p style="font-size:12px;color:#717171;">' || public.h(v_ref) || '</p>'
      || '<div style="font-size:14px;color:#222;padding:12px 16px;background:#F7F7F7;border-radius:10px;white-space:pre-wrap;">'
      || public.h(new.body)
      || '</div>'
      || '<p style="font-size:12px;color:#717171;margin-top:8px;">送信日時：' || v_sent || '（日本時間）</p>'
      || '<a href="' || v_link || '" style="display:inline-block;margin-top:14px;background:#00A86B;color:#fff;'
      || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
      || 'チャットを開いて返信する</a>'
      || '<p style="font-size:12px;margin-top:14px;"><a href="' || v_contact || '" style="color:#717171;">'
      || 'お問い合わせ（チャット一覧の「運営チャット」からご連絡ください）</a></p>'
      || v_footer_html
      || '</div>');
  exception when others then null; end;
  return new;
end; $function$;
CREATE TRIGGER notify_message AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION trg_notify_message();
CREATE OR REPLACE FUNCTION public.notify_push_on_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
declare v_worker uuid; v_farmer uuid; v_recipient uuid; v_secret text; v_url text;
begin
  select worker_id, farmer_id into v_worker, v_farmer from public.applications where id = new.application_id;
  if v_worker is null then return new; end if;
  v_recipient := case when new.sender_id = v_worker then v_farmer else v_worker end;
  if v_recipient is null then return new; end if;
  if not exists (select 1 from public.push_subscriptions ps where ps.auth_id = v_recipient) then return new; end if;
  select trigger_secret into v_secret from public.push_config where id = 1;
  v_url := 'https://aegwepgtmwcnwzybpgsh.supabase.co/functions/v1/send-push';
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-trigger-secret', v_secret),
    body := jsonb_build_object('recipient_id', v_recipient, 'kind', 'message', 'id', new.id));
  return new;
exception when others then return new; end; $function$;
CREATE TRIGGER trg_notify_push_message AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION notify_push_on_message();
CREATE OR REPLACE FUNCTION public.confirm_terms(p_application_id uuid, p_accept_double_booking boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_worker uuid; v_farmer uuid; v_job int; v_both boolean;
        v_first_farmer boolean := false; v_farmer_name text; v_title text;
        v_headcount int; v_hired int; v_filled boolean := false;
        v_closed uuid[] := '{}'; v_ref text; r record;
        v_dup int;
begin
  select worker_id, farmer_id, job_number into v_worker, v_farmer, v_job
    from public.applications where id = p_application_id;
  if v_worker is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;

  if auth.uid() = v_worker then
    update public.applications set terms_confirmed_worker_at = coalesce(terms_confirmed_worker_at, now())
     where id = p_application_id;
  elsif auth.uid() = v_farmer then
    select terms_confirmed_farmer_at is null into v_first_farmer
      from public.applications where id = p_application_id;
    -- ★二重予約の壁（2026-08-06）：初回確定・受諾なしの時だけ調べて拒否。
    --   実働日集合（agreed_dates優先／無ければ範囲・holidays除外）の積が空でなければ重複。
    --   進行中の判定は app_phase（DB側の段階ラベルの唯一のソース・2026-08-07）
    if v_first_farmer and not coalesce(p_accept_double_booking, false) then
      select a2.job_number into v_dup
        from public.applications a2
       where a2.farmer_id = v_farmer and a2.worker_id = v_worker
         and a2.job_number is distinct from v_job
         and public.app_phase(a2) in ('interview','contracted','working')
         and exists (
           select 1
             from public.app_work_dates(p_application_id) d1
             join public.app_work_dates(a2.id) d2 on d1 = d2
         )
       limit 1;
      if v_dup is not null then
        return json_build_object('ok', false, 'reason', 'double_booked', 'dup_job', v_dup);
      end if;
    end if;
    update public.applications set terms_confirmed_farmer_at = coalesce(terms_confirmed_farmer_at, now())
     where id = p_application_id;
  else
    return json_build_object('ok', false, 'reason', 'not_party');
  end if;

  select terms_confirmed_worker_at is not null and terms_confirmed_farmer_at is not null
    into v_both from public.applications where id = p_application_id;
  if v_both then
    update public.applications a
       set terms_snapshot = coalesce(a.terms_snapshot,
         (select to_jsonb(j) - 'lat' - 'lng' from public.jobs j where j.job_number = v_job)
         || jsonb_build_object('snapshot_at', now()))
     where a.id = p_application_id;
  end if;

  if v_first_farmer then
    begin
      select nullif(btrim(ep.nickname), '') into v_farmer_name
        from public.employer_profiles ep where ep.auth_id = v_farmer;
      v_farmer_name := coalesce(v_farmer_name, '農家');
      select nullif(btrim(concat_ws(' ', j.crop, j.task)), '') into v_title
        from public.jobs j where j.job_number = v_job;
      v_title := coalesce(v_title, '求人 #' || v_job);

      insert into public.messages (application_id, sender_id, body)
      values (p_application_id, v_farmer,
        '🎉 採用が決定しました！「' || v_title || '」でよろしくお願いします。当日までの確認は、このチャットで行いましょう。');

      perform public.send_user_email(v_worker,
        '[chitose-bank] 採用が決定しました',
        v_farmer_name || 'さんの求人「' || v_title || '」(#' || v_job || ')に採用されました。' || E'\n\n' ||
        '■ ここからの流れ：' || E'\n' ||
        '作業日までにチャットで最終確認（集合場所・持ち物・時間）→ 当日作業 → 終了後にお互いを評価します。' || E'\n\n' ||
        '▶ チャットを開く：https://chitose-bank.com/#/chat/' || p_application_id);
    exception when others then null; end;
  end if;

  if v_first_farmer then
    select j.headcount into v_headcount from public.jobs j where j.job_number = v_job;
    select count(*) into v_hired from public.applications a
      where a.job_number = v_job
        and a.terms_confirmed_worker_at is not null
        and a.terms_confirmed_farmer_at is not null;
    if v_headcount is not null and v_headcount > 0 and v_hired >= v_headcount then
      v_filled := true;
      -- ★満員＝募集の終了（2026-08-16たきと指示）。行は残す＝さがすには「掲載終了（満員）」で並び続け、
      --   応募は apply_to_job が job_not_open で拒否する（見た目の帯だけでなく機構で閉じる）
      update public.jobs set status = 'closed'
       where job_number = v_job and status = 'open';
      v_ref := public.job_ref(v_job, 'worker');
      for r in
        select a.id, a.worker_id from public.applications a
         where a.job_number = v_job
           and a.id <> p_application_id
           and a.status in ('applied','approved','meeting','interview')
           and not (a.terms_confirmed_worker_at is not null and a.terms_confirmed_farmer_at is not null)
      loop
        update public.applications
           set status = 'rejected', decided_at = coalesce(decided_at, now())
         where id = r.id;
        v_closed := v_closed || r.id;
        begin
          insert into public.messages (application_id, sender_id, body)
          values (r.id, v_farmer,
            'この求人は、予定していた人数の採用が決まったため募集を終了しました。' ||
            'ご応募いただいたのに、お力になれずすみません。またの機会によろしくお願いします。');
        exception when others then null; end;
        begin
          insert into public.notifications (farmer_id, type, message)
          values (r.worker_id, 'application_declined',
                  '求人 #' || v_job || '：募集人数に達したため終了しました。今回はご縁がありませんでした');
        exception when others then null; end;
        begin
          perform public.send_user_email(r.worker_id,
            '[chitose-bank] 募集終了のお知らせ：求人 #' || v_job,
            '■ ' || v_ref || E'\n\n' ||
            'この求人は、予定していた採用人数に達したため募集を終了しました。' || E'\n' ||
            '今回はご縁がありませんでした。ご応募いただき、ありがとうございました。' || E'\n\n' ||
            '※ 選考の結果ではなく、募集人数に達したことによる終了です。' || E'\n\n' ||
            '他の求人を見る：https://chitose-bank.com/#/search');
        exception when others then null; end;
      end loop;
    end if;
  end if;

  return (select json_build_object('ok', true,
      'worker_confirmed', terms_confirmed_worker_at is not null,
      'farmer_confirmed', terms_confirmed_farmer_at is not null,
      'filled', v_filled,
      'closed_ids', to_jsonb(v_closed))
    from public.applications where id = p_application_id);
end; $function$;
