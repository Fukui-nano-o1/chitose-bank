-- First-confirmation boundary only. No table data, policies, grants or Auth config changes.
-- Apply this single reviewed migration only; never replay the historical directory.
-- Fail closed if the production function changed since the catalog-only preflight.
DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = to_regprocedure('public.confirm_terms(uuid,boolean)')
       AND md5(pg_get_functiondef(p.oid)) = 'd9c0da2e9adcf5faedc4ea06d937a428'
       AND p.proowner = 'postgres'::regrole AND p.prosecdef
       AND has_schema_privilege('postgres', 'auth', 'USAGE')
       AND has_table_privilege('postgres', 'auth.users', 'SELECT')
       AND has_table_privilege('postgres', 'auth.users', 'UPDATE')
       AND p.proacl::text = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
  ) THEN
    RAISE EXCEPTION 'HIRING_PREFLIGHT_DRIFT: inspect confirm_terms definition/owner/ACL before applying';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.confirm_terms(p_application_id uuid, p_accept_double_booking boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_worker uuid; v_farmer uuid; v_job int; v_both boolean;
        v_first_farmer boolean := false; v_farmer_name text; v_title text;
        v_headcount int; v_hired int; v_filled boolean := false;
        v_closed uuid[] := '{}'; v_ref text; r record;
        v_dup int;
        v_actor uuid := auth.uid(); v_app public.applications%rowtype;
        v_listing public.jobs%rowtype; v_now timestamptz; v_due timestamptz;
        v_start_text text; v_start time;
begin
  -- Resolve identity without taking locks for an unrelated caller.
  select * into v_app from public.applications where id = p_application_id;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_actor = v_app.worker_id then
    return json_build_object('ok', false, 'reason', 'use_worker_confirmation');
  elsif v_actor is null or v_actor is distinct from v_app.farmer_id then
    return json_build_object('ok', false, 'reason', 'not_party');
  end if;
  v_worker := v_app.worker_id; v_farmer := v_app.farmer_id; v_job := v_app.job_number;

  -- Moderation writes its row before auth.users. Only lock Auth, in ID order,
  -- then read moderation: never take a moderation lock after an Auth lock.
  -- This serializes an active ban with this operation without changing Auth.
  perform u.id from auth.users u where u.id in (v_farmer, v_worker)
    order by u.id for share;

  -- Job BEFORE application: all confirmations for one capacity serialize before
  -- touching applicants, including the existing reject-other-applicants cascade.
  select * into v_listing from public.jobs where job_number = v_job for no key update;
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_app.farmer_id is distinct from v_actor or v_app.worker_id is distinct from v_worker
     or v_app.job_number is distinct from v_job then
    return json_build_object('ok', false, 'reason', 'application_changed');
  end if;
  v_now := clock_timestamp(); -- deadlines must not use time from before a lock wait
  if public.is_account_moderated(v_actor) or not exists (
    select 1 from auth.users u where u.id = v_actor
      and (u.banned_until is null or u.banned_until <= v_now)
  ) then return json_build_object('ok', false, 'reason', 'account_suspended'); end if;

  -- Acknowledgment only, never a repair/backfill. In particular no UPDATE,
  -- snapshot, notice, count or cascade on replay after closure/cancel/completion.
  if v_app.terms_confirmed_farmer_at is not null then
    return json_build_object('ok', true,
      'worker_confirmed', v_app.terms_confirmed_worker_at is not null,
      'farmer_confirmed', true, 'filled', false, 'closed_ids', '[]'::jsonb);
  end if;

  if v_app.status is null or v_app.status not in ('approved','meeting','interview') then
    return json_build_object('ok', false, 'reason', 'application_not_hirable');
  end if;
  if v_app.terms_confirmed_worker_at is null then
    return json_build_object('ok', false, 'reason', 'worker_confirmation_required');
  end if;
  if public.is_account_moderated(v_worker) or not exists (
    select 1 from auth.users u where u.id = v_worker
      and (u.banned_until is null or u.banned_until <= v_now)
  ) then return json_build_object('ok', false, 'reason', 'worker_suspended'); end if;
  if v_listing.job_number is null or v_listing.farmer_id is distinct from v_actor then
    return json_build_object('ok', false, 'reason', 'job_not_found');
  end if;
  if v_listing.status is distinct from 'open' then
    return json_build_object('ok', false, 'reason', 'job_not_open');
  end if;
  if v_listing.headcount is null or v_listing.headcount <= 0 then
    return json_build_object('ok', false, 'reason', 'invalid_capacity');
  end if;

  -- A legacy farmer-only confirmation still reserves a place: a later worker
  -- acknowledgment must not create an uncounted extra hire. Never free historical
  -- confirmed places implicitly based on a later terminal status.
  select count(*) into v_hired from public.applications a
    where a.job_number = v_job and a.terms_confirmed_farmer_at is not null;
  if v_hired >= v_listing.headcount then
    return json_build_object('ok', false, 'reason', 'job_filled');
  end if;

  v_due := public.app_work_due_at(p_application_id);
  if v_due is null then
    return json_build_object('ok', false, 'reason', 'work_dates_required');
  end if;
  if v_due <= v_now or coalesce(v_listing.date_end, v_listing.date_start)
       < (v_now at time zone 'Asia/Tokyo')::date then
    return json_build_object('ok', false, 'reason', 'work_expired');
  end if;
  -- Match the existing single-day expiration rule at work START, while period
  -- work remains possible until its last effective day. Parse only a valid time;
  -- an unreadable legacy time is not silently changed to a made-up start time.
  if coalesce(v_listing.date_end, v_listing.date_start) = v_listing.date_start then
    v_start_text := substring(coalesce(v_listing.work_time, '')
      from '^[[:space:]]*([0-9]{1,2}:[0-9]{2})');
    if v_start_text is not null and split_part(v_start_text, ':', 1)::int between 0 and 23
       and split_part(v_start_text, ':', 2)::int between 0 and 59 then
      v_start := v_start_text::time;
      if v_now >= ((v_listing.date_start + v_start) at time zone 'Asia/Tokyo') then
        return json_build_object('ok', false, 'reason', 'work_expired');
      end if;
    end if;
  end if;

  if v_actor = v_farmer then
    v_first_farmer := true;
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
           and a.terms_confirmed_farmer_at is null
         order by a.id for update of a
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
end; $function$
