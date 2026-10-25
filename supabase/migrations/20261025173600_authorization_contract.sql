-- Authorization contract: database decisions are authoritative; UI checks are hints.
-- Baseline: production schema 2026-10-26 JST. No email/JWT metadata admin bypass.
begin;

create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.app_admins a where a.auth_id = auth.uid()
  )
$$;
revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to anon, authenticated, service_role;

create or replace function private.support_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_app_admin()
$$;

-- The dispute clock starts when absence is recorded, not at the end of work.
alter table public.applications add column if not exists no_show_recorded_at timestamptz;
-- Only dated evidence is used for historical records. Missing evidence stays NULL;
-- never grant a fresh 72-hour window by using the migration's timestamp.
update public.applications a set no_show_recorded_at = x.at
from (
  select row_pk, max(at) as at from public.event_audit
  where table_name = 'applications' and op = 'UPDATE'
    and diff->'attended'->'new' = 'false'::jsonb
  group by row_pk
) x
where a.id::text = x.row_pk and a.attended = false and a.no_show_recorded_at is null;

create or replace function private.stamp_no_show_recorded_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.no_show_recorded_at := case when new.attended = false then clock_timestamp() else null end;
  elsif new.attended = false and old.attended is distinct from false then
    new.no_show_recorded_at := clock_timestamp();
  else
    new.no_show_recorded_at := old.no_show_recorded_at;
  end if;
  return new;
end $$;
revoke all on function private.stamp_no_show_recorded_at() from public, anon, authenticated;
create trigger authz_no_show_clock before insert or update on public.applications
for each row execute function private.stamp_no_show_recorded_at();

-- NULL means allowed. A named denial covers every other input, including unknown actions.
-- The actor, ownership, state and clock all come from the server/database.
create or replace function private.application_write_denial(p_id uuid, p_action text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare a public.applications%rowtype; v_uid uuid := auth.uid();
begin
  if v_uid is null then return 'not_logged_in'; end if;
  if not exists(select 1 from auth.users u where u.id = v_uid and
      (u.banned_until is null or u.banned_until <= clock_timestamp()))
    or public.is_account_moderated(v_uid) then return 'account_suspended'; end if;
  select * into a from public.applications where id = p_id;
  if not found or (v_uid is distinct from a.worker_id and v_uid is distinct from a.farmer_id)
    then return 'not_party'; end if;
  if p_action = 'confirm_terms' then
    if v_uid is distinct from a.farmer_id then return 'use_worker_confirmation'; end if;
    if a.status in ('canceled','cancelled','expired','rejected','completed') then return 'closed'; end if;
    if a.status is null or a.status not in ('approved','meeting','interview','contracted','working')
      then return 'not_approved'; end if;
    return null;
  elsif p_action = 'dispute_no_show' then
    if v_uid is distinct from a.worker_id then return 'not_party'; end if;
    if a.attended is distinct from false then return 'no_show_not_recorded'; end if;
    if a.no_show_recorded_at is null then return 'dispute_time_unknown'; end if;
    if clock_timestamp() < a.no_show_recorded_at
      or clock_timestamp() >= a.no_show_recorded_at + interval '72 hours'
      then return 'dispute_window_closed'; end if;
    return null;
  end if;
  return 'unknown_action';
end $$;
revoke all on function private.application_write_denial(uuid,text) from public, anon, authenticated;

create or replace function private.guard_attendance_dispute()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_reason text;
begin
  if new.kind = 'dispute_no_show' then
    -- Serializes with changes to attendance/absence state.
    perform 1 from public.applications where id = new.application_id for update;
    v_reason := private.application_write_denial(new.application_id, 'dispute_no_show');
    if new.actor_id is distinct from auth.uid() then v_reason := 'not_party'; end if;
    if v_reason is not null then raise exception '%', v_reason using errcode = '42501'; end if;
  end if;
  new.created_at := clock_timestamp();
  return new;
end $$;
revoke all on function private.guard_attendance_dispute() from public, anon, authenticated;
create trigger authz_attendance_dispute before insert on public.attendance_events
for each row execute function private.guard_attendance_dispute();

-- Read receipts are the only mutable field, for the receiving party only.
create or replace function private.guard_admin_message_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := clock_timestamp();
    new.read_at := null;
    return new;
  elsif tg_op = 'DELETE' then
    raise exception 'message_history_immutable' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'message_history_immutable' using errcode = '42501';
  end if;
  if not ((old.from_admin and old.user_id = auth.uid())
       or (not old.from_admin and public.is_app_admin())) then
    raise exception 'read_receipt_recipient_only' using errcode = '42501';
  end if;
  new.read_at := coalesce(old.read_at, clock_timestamp());
  return new;
end $$;
revoke all on function private.guard_admin_message_history() from public, anon, authenticated;
create trigger authz_admin_message_history before insert or update or delete on public.admin_messages
for each row execute function private.guard_admin_message_history();

-- No body text in the audit ledger. Audit failure rolls back this sensitive write.
create or replace function private.audit_admin_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.read_at is distinct from old.read_at then
    insert into public.event_audit(actor,table_name,op,row_pk,diff)
    values(auth.uid(),'admin_messages',tg_op,new.id::text,
      jsonb_build_object('from_admin',new.from_admin,'read_at',new.read_at));
  end if;
  return new;
end $$;
revoke all on function private.audit_admin_message() from public, anon, authenticated;
create trigger authz_admin_message_audit after insert or update on public.admin_messages
for each row execute function private.audit_admin_message();

alter policy "jpc owner insert" on public.job_publish_checks with check (
  farmer_id = auth.uid() and exists (
    select 1 from public.jobs j
    where j.job_number = job_publish_checks.job_number and j.farmer_id = auth.uid()
  )
);

-- All administrative RLS paths use the same database membership check.

alter policy "box registry admin all" on "public"."admin_box_registry" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "cd admin all" on "public"."consignment_deals" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "consignment admin only" on "public"."consignment_deals" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "dests admin read" on "public"."dests" using ((select public.is_app_admin()));
alter policy "dests_admin_delete" on "public"."dests" using ((select public.is_app_admin()));
alter policy "dests_admin_update" on "public"."dests" using ((select public.is_app_admin()));
alter policy "audit admin read" on "public"."event_audit" using ((select public.is_app_admin()));
alter policy "am insert" on "public"."admin_messages" with check ((((user_id = auth.uid()) AND (from_admin = false)) OR ((from_admin = true) AND (select public.is_app_admin()))));
alter policy "am select" on "public"."admin_messages" using (((user_id = auth.uid()) OR (select public.is_app_admin())));
alter policy "am update" on "public"."admin_messages" using (((user_id = auth.uid()) OR (select public.is_app_admin()))) with check (((user_id = auth.uid()) OR (select public.is_app_admin())));
alter policy "notice registry admin all" on "public"."admin_notice_registry" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "records_admin" on "public"."records" using ((select public.is_app_admin()));
alter policy "records_admin_delete" on "public"."records" using ((select public.is_app_admin()));
alter policy "records_admin_select" on "public"."records" using ((select public.is_app_admin()));
alter policy "consignment-photos admin delete" on "storage"."objects" using (((bucket_id = 'consignment-photos'::text) AND (select public.is_app_admin())));
alter policy "consignment-photos admin insert" on "storage"."objects" with check (((bucket_id = 'consignment-photos'::text) AND (select public.is_app_admin())));
alter policy "consignment-photos admin update" on "storage"."objects" using (((bucket_id = 'consignment-photos'::text) AND (select public.is_app_admin()))) with check (((bucket_id = 'consignment-photos'::text) AND (select public.is_app_admin())));
alter policy "farm-timeless admin delete" on "storage"."objects" using (((bucket_id = 'farm-timeless'::text) AND (select public.is_app_admin())));
alter policy "farm-timeless admin insert" on "storage"."objects" with check (((bucket_id = 'farm-timeless'::text) AND (select public.is_app_admin())));
alter policy "farm-timeless admin update" on "storage"."objects" using (((bucket_id = 'farm-timeless'::text) AND (select public.is_app_admin()))) with check (((bucket_id = 'farm-timeless'::text) AND (select public.is_app_admin())));
alter policy "help img admin delete" on "storage"."objects" using (((bucket_id = 'help-images'::text) AND (select public.is_app_admin())));
alter policy "help img admin update" on "storage"."objects" using (((bucket_id = 'help-images'::text) AND (select public.is_app_admin()))) with check (((bucket_id = 'help-images'::text) AND (select public.is_app_admin())));
alter policy "help img admin write" on "storage"."objects" with check (((bucket_id = 'help-images'::text) AND (select public.is_app_admin())));
alter policy "job-photos admin write" on "storage"."objects" using (((bucket_id = 'job-photos'::text) AND (select public.is_app_admin()))) with check (((bucket_id = 'job-photos'::text) AND (select public.is_app_admin())));
alter policy "pay incidents admin all" on "public"."pay_incidents" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "pr admin update" on "public"."profile_reports" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "pr select admin" on "public"."profile_reports" using ((select public.is_app_admin()));
alter policy "farmers admin update" on "public"."farmers" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "farmers_admin" on "public"."farmers" using ((select public.is_app_admin()));
alter policy "farmers_admin_select" on "public"."farmers" using ((select public.is_app_admin()));
alter policy "wp admin select" on "public"."worker_profiles" using ((select public.is_app_admin()));
alter policy "wp admin update" on "public"."worker_profiles" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "report admin update" on "public"."job_reports" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "report select admin" on "public"."job_reports" using ((select public.is_app_admin()));
alter policy "hi admin delete" on "public"."help_images" using ((select public.is_app_admin()));
alter policy "hi admin update" on "public"."help_images" using ((select public.is_app_admin()));
alter policy "hi admin write" on "public"."help_images" with check ((select public.is_app_admin()));
alter policy "att admin select" on "public"."attendance_events" using ((select public.is_app_admin()));
alter policy "jq read" on "public"."job_questions" using (((hidden = false) OR (asker_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM jobs j
  WHERE ((j.job_number = job_questions.job_number) AND (j.farmer_id = auth.uid())))) OR (select public.is_app_admin())));
alter policy "am admin all" on "public"."account_moderation" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "admin_select_app_errors" on "public"."app_errors" using ((select public.is_app_admin()));
alter policy "admin_update_app_errors" on "public"."app_errors" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "mr admin all" on "public"."message_reports" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "cprog admin only" on "public"."consignment_progress" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "survey admin select" on "public"."user_onboarding_survey" using ((select public.is_app_admin()));
alter policy "pe insert self admin only" on "public"."page_events" with check (((auth_id = auth.uid()) AND (select public.is_app_admin())));
alter policy "pe select admin" on "public"."page_events" using ((select public.is_app_admin()));
alter policy "product_events_admin_select" on "public"."product_events" using ((select public.is_app_admin()));
alter policy "fb select admin" on "public"."feedback" using ((select public.is_app_admin()));
alter policy "fb update admin" on "public"."feedback" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "wr admin update" on "public"."withdrawal_requests" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "wr self or admin select" on "public"."withdrawal_requests" using (((auth.uid() = auth_id) OR (select public.is_app_admin())));
alter policy "jpc admin select" on "public"."job_publish_checks" using ((select public.is_app_admin()));
alter policy "pending admin read" on "public"."pending_applications" using ((select public.is_app_admin()));
alter policy "jobs admin write" on "public"."jobs" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "ep admin select" on "public"."employer_profiles" using ((select public.is_app_admin()));
alter policy "consignment_profiles admin all" on "public"."consignment_profiles" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "consignment_fields admin all" on "public"."consignment_fields" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
alter policy "ahc self or admin read" on "public"."account_holder_changes" using (((auth.uid() = account_auth_id) OR (select public.is_app_admin())));
alter policy "wpvc self select" on "public"."worker_profile_view_counts" using (((worker_id = auth.uid()) OR (select public.is_app_admin())));
alter policy "farm_timeless admin all" on "public"."farm_timeless_posts" using ((select public.is_app_admin())) with check ((select public.is_app_admin()));

-- Lock and re-check the current row before any contract side effect.

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
        v_dup int; v_denial text;
begin
  select worker_id, farmer_id, job_number into v_worker, v_farmer, v_job
    from public.applications where id = p_application_id for update;
  if v_worker is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;

  v_denial := private.application_write_denial(p_application_id, 'confirm_terms');
  if v_denial is not null then return json_build_object('ok', false, 'reason', v_denial); end if;

  if auth.uid() = v_worker then
    return json_build_object('ok', false, 'reason', 'use_worker_confirmation');
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
end; $function$
;
CREATE OR REPLACE FUNCTION public.record_my_attendance_once(p_owner uuid, p_event_id uuid, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_uid uuid:=auth.uid();
  v_input jsonb;
  v_previous jsonb;
  v_row public.attendance_events%rowtype;
begin
  if v_uid is null or p_owner is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  if p_event_id is null or jsonb_typeof(p_input) is distinct from 'object'
    or not (p_input ?& array['application_id','kind'])
    or p_input - array['application_id','kind','reason','work_date','detail'] <> '{}'::jsonb
    or jsonb_typeof(p_input->'application_id') is distinct from 'string'
    or jsonb_typeof(p_input->'kind') is distinct from 'string' or octet_length(p_input::text)>65536
    or exists(select 1 from jsonb_each(p_input) where key in ('reason','detail','work_date') and value<>'null'::jsonb and jsonb_typeof(value)<>'string') then
    return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  v_input:=jsonb_build_object('application_id',(p_input->>'application_id')::uuid,'kind',p_input->>'kind',
    'reason',p_input->>'reason','work_date',(p_input->>'work_date')::date,'detail',p_input->>'detail');
  perform pg_advisory_xact_lock(hashtextextended('attendance:'||p_event_id::text,0));
  select * into v_row from public.attendance_events where id=p_event_id;
  if found then
    select jsonb_object_agg(key,value) into v_previous from jsonb_each(to_jsonb(v_row)) where key=any(array['application_id','kind','reason','work_date','detail']);
    if v_row.actor_id is distinct from v_uid or v_previous is distinct from v_input then return jsonb_build_object('ok',false,'reason','request_mismatch'); end if;
    return jsonb_build_object('ok',true,'row',to_jsonb(v_row),'replayed',true);
  end if;
  begin
    insert into public.attendance_events(id,application_id,actor_id,kind,reason,work_date,detail)
      values(p_event_id,(v_input->>'application_id')::uuid,v_uid,v_input->>'kind',v_input->>'reason',(v_input->>'work_date')::date,v_input->>'detail')
      returning * into v_row;
    if v_row.id is null then raise exception 'ATTENDANCE_NOT_SAVED'; end if;
    return jsonb_build_object('ok',true,'row',to_jsonb(v_row),'replayed',false);
  exception when unique_violation then
    -- Another permitted insertion path may not take this advisory lock.
    select * into v_row from public.attendance_events where id=p_event_id and actor_id=v_uid;
    select jsonb_object_agg(key,value) into v_previous from jsonb_each(to_jsonb(v_row)) where key=any(array['application_id','kind','reason','work_date','detail']);
    if v_row.id is not null and v_previous=v_input then return jsonb_build_object('ok',true,'row',to_jsonb(v_row),'replayed',true); end if;
    return jsonb_build_object('ok',false,'reason','request_mismatch');
  when others then
    return jsonb_build_object('ok',false,'reason',case when sqlstate='42501' and sqlerrm in ('dispute_window_closed','dispute_time_unknown','no_show_not_recorded','not_party','account_suspended') then sqlerrm else 'save_rejected' end,'code',sqlstate);
  end;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
  return jsonb_build_object('ok',false,'reason','invalid_input');
end $function$
;

-- Shared administrator predicate inside database functions as well as RLS.
CREATE OR REPLACE FUNCTION public.admin_review_comments()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v json;
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  -- 判断に必要なのは本文だけ。当事者名は返さない（運営の主観・関与を最小化・2026-08-07の作法）
  select coalesce(json_agg(json_build_object(
           'id', r.id, 'comment', r.public_comment, 'direction', r.direction,
           'status', r.comment_status,
           'created_at', to_char(r.created_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'))
         order by r.created_at desc), '[]'::json)
    into v
    from public.reviews r
   where nullif(btrim(coalesce(r.public_comment,'')),'') is not null;
  return json_build_object('ok', true, 'items', v);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.moderate_review_comment(p_review_id uuid, p_approve boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  -- 即時公開になったので、承認ではなく「非表示にする／公開に戻す」の操作になった
  update public.reviews
     set comment_status = case when p_approve then 'approved' else 'rejected' end
   where id = p_review_id
     and nullif(btrim(coalesce(public_comment,'')),'') is not null;
  if not found then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  return json_build_object('ok', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.count_worker_profile_view(p_worker_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or p_worker_id is null then return; end if;
  if auth.uid() = p_worker_id then return; end if; -- 本人は数えない
  if public.is_app_admin() then return; end if; -- 運営は数えない
  -- 応募関係のある農家だけ数える（関係ゲート＝worker_work_recordと同じ相手）
  if not exists (
    select 1 from public.applications a
    where a.worker_id = p_worker_id and a.farmer_id = auth.uid()
  ) then return; end if;
  insert into public.worker_profile_view_counts (worker_id, view_count, updated_at)
       values (p_worker_id, 1, now())
  on conflict (worker_id) do update
    set view_count = public.worker_profile_view_counts.view_count + 1, updated_at = now();
end $function$
;
CREATE OR REPLACE FUNCTION public.worker_cards_for_farmer(p_worker_ids uuid[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v json; v_admin boolean;
begin
  if auth.uid() is null or p_worker_ids is null then return '[]'::json; end if;
  v_admin := public.is_app_admin();
  select coalesce(json_agg(json_build_object(
           'auth_id', wp.auth_id, 'nickname', wp.nickname, 'avatar_url', wp.avatar_url)), '[]'::json)
    into v
    from public.worker_profiles wp
   where wp.auth_id = any(p_worker_ids)
     and not public.is_account_moderated(wp.auth_id)
     and ( v_admin
           or exists (select 1 from public.applications a
                       where a.worker_id = wp.auth_id and a.farmer_id = auth.uid()) );
  return v;
end; $function$
;
CREATE OR REPLACE FUNCTION public.consignment_summary(p_deal_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_area numeric; v_hours numeric; v_boxes int; v_days int; v_workers int;
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  select coalesce(area_a, nullif(btrim(spec->>'area_a'),'')::numeric) into v_area
    from public.consignment_deals where id = p_deal_id;
  select coalesce(sum(hours),0), coalesce(sum(yield_boxes),0), count(distinct work_date), coalesce(sum(workers),0)
    into v_hours, v_boxes, v_days, v_workers
    from public.consignment_progress where deal_id = p_deal_id;
  return json_build_object('ok', true,
    'total_hours', v_hours, 'total_boxes', v_boxes, 'work_days', v_days, 'total_workers', v_workers,
    'area_a', v_area,
    'hours_per_10a', case when v_area is not null and v_area > 0 then round(v_hours * 10 / v_area, 1) else null end);
end; $function$
;
CREATE OR REPLACE FUNCTION public.my_unread_message_counts()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mine as (
    select a.id, a.status, a.status_changed_at, a.status_changed_by
      from applications a
     where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
       and a.status not in ('rejected','expired','canceled')
  ),
  msg as (
    select m.application_id, count(*) as cnt
      from messages m join mine a on a.id = m.application_id
     where m.sender_id <> auth.uid() and m.read_at is null
     group by m.application_id
  ),
  stat as (
    select a.id as application_id, 1 as cnt
      from mine a
     where a.status_changed_at is not null
       and a.status_changed_by is distinct from auth.uid()
       and not exists (select 1 from chat_reads r
                        where r.application_id = a.id and r.reader_id = auth.uid()
                          and r.last_read_at >= a.status_changed_at)
  ),
  merged as (
    select application_id, sum(cnt)::int as cnt
      from (select * from msg union all select * from stat) u
     group by application_id
  )
  select json_build_object(
    'chat', (select coalesce(sum(cnt), 0)::int from merged),
    'dm', (select count(*) from admin_messages am
            where (am.user_id = auth.uid() and am.from_admin and am.read_at is null)
               or (not am.from_admin and am.read_at is null
                   and public.is_app_admin()
                   and not exists (select 1 from app_admins ad2 where ad2.auth_id = am.user_id))),
    'by_application', (select coalesce(json_object_agg(application_id, cnt), '{}'::json) from merged)
  );
$function$
;
CREATE OR REPLACE FUNCTION public.worker_profile_for_farmer(p_worker_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v json; v_priv boolean; v_entitled boolean; v_pending boolean;
begin
  if auth.uid() is null or p_worker_id is null then return null; end if;
  -- 特権＝本人 or 運営（審査中でも見える・全安全列）。農家＝応募を受けた関係のみ・審査中は伏せる
  v_priv := (auth.uid() = p_worker_id) or public.is_app_admin();
  v_entitled := v_priv or ( not public.is_account_moderated(p_worker_id)
                            and exists (select 1 from public.applications a
                                         where a.worker_id = p_worker_id and a.farmer_id = auth.uid()) );
  if not v_entitled then return null; end if;
  -- 審査中（未承認の自己紹介がある）は農家に見せない＝本文は返さず under_review のみ（2026-07-19の非表示ゲートを維持）
  if not v_priv then
    select (nullif(btrim(coalesce(pr_pending,'')),'') is not null
            or (pr_qa_pending is not null and jsonb_typeof(pr_qa_pending)='array'
                and jsonb_array_length(pr_qa_pending) > 0))
      into v_pending from public.worker_profiles where auth_id = p_worker_id;
    if coalesce(v_pending,false) then return json_build_object('under_review', true); end if;
  end if;
  select json_build_object(
    'auth_id', wp.auth_id, 'nickname', wp.nickname, 'pr', wp.pr, 'avatar_url', wp.avatar_url,
    'created_at', wp.created_at, 'residence_city', wp.residence_city, 'transport', wp.transport,
    'farm_experience', wp.farm_experience, 'experienced_tasks', wp.experienced_tasks,
    'physical_level', wp.physical_level, 'pr_qa', wp.pr_qa, 'interests', wp.interests,
    'languages', wp.languages, 'self_declared', wp.self_declared, 'experience_entries', wp.experience_entries,
    'work_mood', wp.work_mood, 'learning_pref', wp.learning_pref, 'work_pattern', wp.work_pattern
  ) into v from public.worker_profiles wp where wp.auth_id = p_worker_id;
  return v;  -- pr_pending / pr_qa_pending / pr_hidden_original / pr_revision_targets は含めない
end; $function$
;
CREATE OR REPLACE FUNCTION private.remember_admin_listing_photos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not public.is_app_admin() then return new; end if;
  insert into private.listing_photo_legacy_access(bucket_id,object_name,farmer_id)
  select distinct o.bucket_id,o.name,new.farmer_id
  from private.listing_photo_urls(new.photos,new.danger_places,new.danger_tasks) u(url)
  join storage.objects o on u.url='https://aegwepgtmwcnwzybpgsh.supabase.co/storage/v1/object/public/' || o.bucket_id || '/' || o.name
  where o.bucket_id='job-photos' and o.owner_id <> new.farmer_id::text
    and exists(select 1 from public.app_admins a where a.auth_id::text=o.owner_id)
  on conflict do nothing;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_send_emergency_contact_reminder(p_target uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_subject text := '緊急連絡先のご登録のお願い';
  v_links   text;
  v_mail    text;
  v_sent    int := 0;
begin
  -- 実行できるのはバックエンド（auth文脈なし＝SQL直）か運営（app_admins）のみ
  if auth.uid() is not null
     and not public.is_app_admin() then
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
end $function$
;
CREATE OR REPLACE FUNCTION public.approve_profile_text(p_auth_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  update public.worker_profiles
     set pr = coalesce(pr_pending, pr),
         pr_qa = coalesce(pr_qa_pending, pr_qa),
         pr_pending = null, pr_qa_pending = null, pr_submitted_at = null
   where auth_id = p_auth_id;
  insert into public.notifications (farmer_id, type, message)
  values (p_auth_id, 'profile_approved', '自己紹介が公開されました');
  return json_build_object('ok', true);
end; $function$
;
CREATE OR REPLACE FUNCTION public.admin_preview_job_time_notices(p_to uuid, p_app uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_app uuid; v_kind text; v_role text; v_mail jsonb; v_n int := 0;
begin
  if auth.uid() is not null
     and not public.is_app_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  v_app := p_app;
  if v_app is null then
    select a.id into v_app
      from public.applications a join public.jobs j on j.job_number = a.job_number
     where a.terms_snapshot is not null and j.work_time ~ '^\d{1,2}:\d{2}'
     order by a.created_at desc limit 1;
  end if;
  if v_app is null then return jsonb_build_object('ok', false, 'reason', 'no_sample'); end if;

  foreach v_kind in array array['before_60','before_15','start','end'] loop
    foreach v_role in array array['worker','farmer'] loop
      v_mail := public.job_time_notice_mail(v_app, v_kind, v_role);
      if v_mail is not null then
        perform public.send_user_email(p_to, v_mail->>'subject',
          '※これは確認用の送信です（実際の予定ではありません）。' || E'\n' ||
          '※宛先の別：' || case when v_role='worker' then '働き手に届く文面' else '農家に届く文面' end || E'\n' ||
          '――――――――――' || E'\n\n' || (v_mail->>'body'),
          '<p style="font-family:sans-serif;font-size:12px;color:#B0B0B0;max-width:560px;margin:0 auto 12px;">'
          || '※これは確認用の送信です（実際の予定ではありません）／'
          || case when v_role='worker' then '働き手に届く文面' else '農家に届く文面' end || '</p>'
          || (v_mail->>'html'));
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'sent', v_n, 'application_id', v_app);
end $function$
;
CREATE OR REPLACE FUNCTION public.admin_list_accounts()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  return (
    select json_agg(json_build_object(
      'auth_id', u.id, 'email', u.email, 'email_masked', public.mask_email(u.email),
      'nickname', wp.nickname, 'avatar_url', wp.avatar_url,
      'has_worker', wp.auth_id is not null,
      'has_employer', ep.auth_id is not null,
      'employer_nickname', ep.nickname, 'employer_avatar_url', ep.avatar_url,
      'confirmed', u.email_confirmed_at is not null, 'never_signed_in', u.last_sign_in_at is null,
      'last_sign_in_jst', to_char(u.last_sign_in_at at time zone 'Asia/Tokyo','MM/DD HH24:MI'),
      'created_jst', to_char(u.created_at at time zone 'Asia/Tokyo','YYYY/MM/DD'),
      'has_id_check', ah.auth_id is not null,
      'id_check_month', to_char(ah.created_at at time zone 'Asia/Tokyo','YYYY年MM月'),
      'pending_text', (wp.pr_pending is not null or wp.pr_qa_pending is not null),
      'pending_since', to_char(wp.pr_submitted_at at time zone 'Asia/Tokyo','MM/DD HH24:MI'),
      'pr_pending', wp.pr_pending, 'pr_qa_pending', wp.pr_qa_pending,
      'mod_state', coalesce(m.state, 'active'), 'mod_reason', m.reason,
      'apps_applied', (select count(*) from public.applications a where a.worker_id = u.id),
      'apps_completed', (select count(*) from public.applications a where a.worker_id = u.id and a.status = 'completed'),
      'jobs_posted', (select count(*) from public.jobs j where j.farmer_id = u.id),
      'want_again', (select count(*) from public.reviews r where r.reviewee_id = u.id and r.direction = 'farmer_to_worker' and r.want_again = true),
      'reported', (select count(*) from public.job_reports jr join public.jobs j2 on j2.job_number = jr.job_number where j2.farmer_id = u.id and jr.status = 'open')
    ) order by
      (coalesce(m.state,'active') <> 'active') desc,
      (wp.pr_pending is not null or wp.pr_qa_pending is not null) desc,
      u.last_sign_in_at desc nulls last)
    from auth.users u
    left join public.worker_profiles wp on wp.auth_id = u.id
    left join public.employer_profiles ep on ep.auth_id = u.id
    left join public.account_holders ah on ah.auth_id = u.id
    left join public.account_moderation m on m.auth_id = u.id
  );
end; $function$
;
CREATE OR REPLACE FUNCTION public.admin_list_contracts()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'application_id', a.id,
      'job_number', a.job_number,
      'status', a.status,
      'worker_id', a.worker_id,
      'farmer_id', a.farmer_id,
      'worker_name', coalesce(
        nullif(btrim(a.terms_snapshot #>> '{party_names,worker}'), ''),
        nullif(btrim(ah_w.full_name), ''),
        wp.nickname),
      'farmer_name', coalesce(
        nullif(btrim(a.terms_snapshot #>> '{party_names,farmer}'), ''),
        nullif(btrim(ah_f.full_name), ''),
        ep.nickname),
      'worker_confirmed_at', to_char(a.terms_confirmed_worker_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
      'farmer_confirmed_at', to_char(a.terms_confirmed_farmer_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
      'snapshot_at', to_char((a.terms_snapshot->>'snapshot_at')::timestamptz at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
      'snapshot', a.terms_snapshot
    ) order by (a.terms_snapshot->>'snapshot_at')::timestamptz desc)
    from public.applications a
    left join public.worker_profiles wp on wp.auth_id = a.worker_id
    left join public.employer_profiles ep on ep.auth_id = a.farmer_id
    left join public.account_holders ah_w on ah_w.auth_id = a.worker_id
    left join public.account_holders ah_f on ah_f.auth_id = a.farmer_id
    where a.terms_snapshot is not null
  ), '[]'::json);
end; $function$
;
CREATE OR REPLACE FUNCTION private.can_read_meeting_address(p_job_number integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select auth.uid() is not null and exists (
    select 1 from public.jobs j where j.job_number=p_job_number and (
      j.farmer_id=auth.uid()
      or public.is_app_admin()
      or exists(select 1 from public.applications a where a.job_number=j.job_number
        and a.worker_id=auth.uid()
        and a.status in ('approved','meeting','interview','contracted','working','completed'))
    )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.admin_preview_application_followups(p_to uuid, p_app uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_app uuid; v_stage int; v_mail jsonb; v_n int := 0;
begin
  if auth.uid() is not null
     and not public.is_app_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  v_app := p_app;
  if v_app is null then
    select id into v_app from public.applications order by created_at desc limit 1;
  end if;
  if v_app is null then return jsonb_build_object('ok', false, 'reason', 'no_sample'); end if;

  foreach v_stage in array array[12,24,36,48,60,72] loop
    v_mail := public.application_followup_mail(v_app, v_stage);
    if v_mail is not null then
      perform public.send_user_email(p_to, v_mail->>'subject',
        '※これは確認用の送信です（実際の督促ではありません）。' || E'\n' ||
        '※経過：' || v_stage || '時間' || E'\n' ||
        '――――――――――' || E'\n\n' || (v_mail->>'body'));
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'sent', v_n, 'application_id', v_app);
end $function$
;
CREATE OR REPLACE FUNCTION public.admin_send_policy_update(p_doc text, p_version text, p_target uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; v_mail jsonb; v_req bigint; v_n int := 0;
begin
  if auth.uid() is not null
     and not public.is_app_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  v_mail := public.policy_update_mail(p_doc, p_version);
  if v_mail is null then return jsonb_build_object('ok', false, 'reason', 'bad_doc'); end if;

  for r in
    with all_users as (
      select auth_id from public.account_holders
      union select auth_id from public.worker_profiles
      union select auth_id from public.employer_profiles
    )
    select a.auth_id from all_users a
     where
       (p_target is not null and a.auth_id = p_target)
       or (
         p_target is null
         and not exists (select 1 from auth.users u
                          where u.id = a.auth_id and u.email like 'withdrawn+%')
         and not public.is_account_moderated(a.auth_id)
         and not exists (select 1 from public.policy_update_notices n
                          where n.auth_id = a.auth_id and n.doc = p_doc and n.version = p_version)
       )
  loop
    begin
      v_req := public.send_user_email(r.auth_id, v_mail->>'subject', v_mail->>'body', v_mail->>'html');
    exception when others then v_req := null; end;

    insert into public.policy_update_notices (auth_id, doc, version, request_id)
    values (r.auth_id, p_doc, p_version, v_req)
    on conflict (auth_id, doc, version) do update set sent_at = now(), request_id = excluded.request_id;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'sent', v_n, 'doc', p_doc, 'version', p_version);
end $function$
;
CREATE OR REPLACE FUNCTION public.admin_product_analytics(p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with measured as (
    select * from public.product_events
    where created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days,7),30)))
  ), pages as (
    select screen, count(*) as views, count(distinct session_id) as sessions
    from measured where event = 'page_view' group by screen
  ), sources as (
    select source, count(distinct session_id) as sessions from measured group by source
  ), operations as (
    select operation_id, split_part(event,'_',1) as name,
      min(created_at) filter (where event like '%_start') as started,
      bool_or(event like '%_success') as succeeded,
      bool_or(event like '%_failure') as failed,
      bool_or(duration_bucket = 'over20s') as slow
    from measured where operation_id is not null group by operation_id, split_part(event,'_',1)
  ), results as (
    select names.name, count(o.started) as started,
      count(*) filter (where o.started is not null and o.succeeded) as succeeded,
      count(*) filter (where o.started is not null and o.failed) as failed,
      count(*) filter (where o.started is not null and not o.succeeded and not o.failed and o.started > now() - interval '30 minutes') as in_progress,
      count(*) filter (where o.started is not null and not o.succeeded and not o.failed and o.started <= now() - interval '30 minutes') as unrecorded,
      count(*) filter (where o.started is not null and o.slow) as slow
    from (values ('apply'),('publish'),('pdf')) as names(name)
    left join operations o on o.name = names.name group by names.name
  ) select jsonb_build_object(
    'sessions', (select count(distinct session_id) from measured),
    'pages', coalesce((select jsonb_agg(to_jsonb(p) order by p.views desc) from pages p),'[]'::jsonb),
    'sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.sessions desc) from sources s),'[]'::jsonb),
    'operations', coalesce((select jsonb_agg(to_jsonb(r) order by r.name) from results r),'[]'::jsonb)
  ) where public.is_app_admin();
$function$
;
CREATE OR REPLACE FUNCTION public.admin_hide_question(p_id uuid, p_hidden boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_app_admin() then
    return json_build_object('ok',false,'reason','not_admin');
  end if;
  update public.job_questions set hidden = p_hidden where id = p_id;
  return json_build_object('ok', true);
end; $function$
;
CREATE OR REPLACE FUNCTION public.trg_lock_account_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (nullif(old.entity_type, '') is not null
        and old.entity_type is distinct from new.entity_type)
     or (nullif(old.company_number, '') is not null
        and old.company_number is distinct from new.company_number) then
    if auth.uid() is not null
       and not public.is_app_admin() then
      raise exception '事業区分・法人番号は変更できません。変更が必要な場合は運営にお問い合わせください';
    end if;
  end if;
  return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.admin_account_jobs(p_auth_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_posted jsonb;
  v_applied jsonb;
begin
  if auth.uid() is null or not public.is_app_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  select coalesce(jsonb_agg(t.x order by t.ord desc), '[]'::jsonb) into v_posted
  from (
    select j.created_at as ord,
      jsonb_build_object(
        'job_number', j.job_number,
        'status', j.status,
        'unlisted', (j.status = 'draft' and j.opened_at is not null),
        'crop', j.crop,
        'task', j.task,
        'city', j.city,
        'date_start', j.date_start,
        'date_end', j.date_end,
        'date_label', j.date_label,
        'photo', j.photos -> 0,
        'headcount', j.headcount,
        'created_jst', to_char(j.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD')
      ) as x
    from jobs j
    where j.farmer_id = p_auth_id
    order by j.created_at desc
    limit 100
  ) t;

  select coalesce(jsonb_agg(t.x order by t.ord desc), '[]'::jsonb) into v_applied
  from (
    select a.created_at as ord,
      jsonb_build_object(
        'application_id', a.id,
        'job_number', a.job_number,
        'phase', public.app_phase(a),
        'status', a.status,
        'applied_jst', to_char(a.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD'),
        'crop', j.crop,
        'task', j.task,
        'city', j.city,
        'job_status', j.status,
        'date_start', j.date_start,
        'date_end', j.date_end,
        'date_label', j.date_label,
        'photo', j.photos -> 0
      ) as x
    from applications a
    left join jobs j on j.job_number = a.job_number
    where a.worker_id = p_auth_id
    order by a.created_at desc
    limit 100
  ) t;

  return jsonb_build_object('ok', true, 'posted', v_posted, 'applied', v_applied);
end
$function$
;
CREATE OR REPLACE FUNCTION public.worker_work_record(p_worker_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_worker json; v_recent json; v_by_crop json; v_by_task json;
  v_days int; v_absent int; v_minutes int; v_unknown int;
  v_admin boolean; v_self boolean; v_detail boolean;
begin
  if auth.uid() is null or p_worker_id is null then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;
  v_admin := public.is_app_admin();
  v_self  := (auth.uid() = p_worker_id);
  if not v_admin and not v_self and not exists (
    select 1 from public.applications a
    where a.worker_id = p_worker_id and a.farmer_id = auth.uid()
  ) then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;
  v_detail := (v_admin or v_self);

  select json_build_object('worker_id', p_worker_id, 'name', wp.nickname)
    into v_worker
    from public.worker_profiles wp where wp.auth_id = p_worker_id;
  if v_worker is null then
    v_worker := json_build_object('worker_id', p_worker_id, 'name', null);
  end if;

  -- 働いた日数・時間（進行中も終わった作業日ぶんだけ数える）
  select coalesce(sum((select count(*) from public.app_accrued_days(a.id) as wd(d))), 0)::int,
         coalesce(sum(public.app_accrued_minutes(a.id)), 0)::int,
         coalesce(sum(case when public.job_scheduled_minutes(j.work_time) is null
                           then (select count(*) from public.app_accrued_days(a.id) as wd(d)) else 0 end), 0)::int
    into v_days, v_minutes, v_unknown
    from public.applications a
    join public.jobs j on j.job_number = a.job_number
   where a.worker_id = p_worker_id and a.status in ('working','completed')
     and a.attended is distinct from false;

  -- 欠勤は仕事の単位で数える（来なかった回＝applications.attended = false）
  select count(*) into v_absent
    from public.applications a
   where a.worker_id = p_worker_id and a.status = 'completed' and a.attended is false;

  -- 直近の仕事5件（進行中も含む。日付は最後に働いた作業日）
  select coalesce(json_agg(row order by ord desc nulls last), '[]'::json) into v_recent
  from (
    select json_build_object(
             'application_id', a.id,
             'job_number', case when v_detail then a.job_number end,
             'crop', case when v_detail then j.crop end,
             'task', case when v_detail then j.task end,
             'work_date', to_char(coalesce(
                            (select max(wd.d) from public.app_accrued_days(a.id) as wd(d)),
                            (a.work_completed_at at time zone 'Asia/Tokyo')::date,
                            j.date_start), 'YYYY/MM/DD'),
             'days', (select count(*) from public.app_accrued_days(a.id) as wd(d)),
             'attended', a.attended,
             'minutes', public.app_accrued_minutes(a.id)
           ) as row,
           coalesce((select max(wd.d) from public.app_accrued_days(a.id) as wd(d)),
                    (a.work_completed_at at time zone 'Asia/Tokyo')::date,
                    j.date_start) as ord
      from public.applications a
      left join public.jobs j on j.job_number = a.job_number
     where a.worker_id = p_worker_id
       and (a.status = 'completed'
            or (a.status = 'working' and exists (select 1 from public.app_accrued_days(a.id) as wd(d))))
     order by ord desc nulls last
     limit 5
  ) t;

  -- 作物別・作業別：件数ではなく【日数】。進行中の仕事も終わった作業日ぶんだけ数える
  select coalesce(json_agg(json_build_object('key', key, 'count', cnt, 'minutes', mins)
                  order by cnt desc, key asc), '[]'::json) into v_by_crop
  from (
    select coalesce(j.crop, '未設定') as key,
           coalesce(sum((select count(*) from public.app_accrued_days(a.id) as wd(d))), 0)::int as cnt,
           coalesce(sum(public.app_accrued_minutes(a.id)), 0)::int as mins
      from public.applications a
      left join public.jobs j on j.job_number = a.job_number
     where a.worker_id = p_worker_id and a.status in ('working','completed')
       and a.attended is distinct from false
     group by 1
    having coalesce(sum((select count(*) from public.app_accrued_days(a.id) as wd(d))), 0) > 0
  ) t;

  select coalesce(json_agg(json_build_object('key', key, 'count', cnt, 'minutes', mins)
                  order by cnt desc, key asc), '[]'::json) into v_by_task
  from (
    select coalesce(j.task, '未設定') as key,
           coalesce(sum((select count(*) from public.app_accrued_days(a.id) as wd(d))), 0)::int as cnt,
           coalesce(sum(public.app_accrued_minutes(a.id)), 0)::int as mins
      from public.applications a
      left join public.jobs j on j.job_number = a.job_number
     where a.worker_id = p_worker_id and a.status in ('working','completed')
       and a.attended is distinct from false
     group by 1
    having coalesce(sum((select count(*) from public.app_accrued_days(a.id) as wd(d))), 0) > 0
  ) t;

  return json_build_object('ok', true, 'worker', v_worker,
    'totals', json_build_object('worked_days', coalesce(v_days,0), 'absent_count', coalesce(v_absent,0),
                                'total_minutes', coalesce(v_minutes,0), 'unknown_time_days', coalesce(v_unknown,0)),
    'profile_view_count', case when v_detail then
      coalesce((select c.view_count from public.worker_profile_view_counts c where c.worker_id = p_worker_id), 0)
    end,
    'recent', v_recent, 'by_crop', v_by_crop, 'by_task', v_by_task);
end; $function$
;
CREATE OR REPLACE FUNCTION public.admin_moderate_account(p_auth_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_state text; v_label text;
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if p_action not in ('suspend','ban','unban') then
    return json_build_object('ok', false, 'reason', 'bad_action');
  end if;
  if exists (select 1 from public.app_admins a where a.auth_id = p_auth_id) then
    return json_build_object('ok', false, 'reason', 'cannot_moderate_admin');
  end if;

  v_state := case p_action when 'suspend' then 'suspended' when 'ban' then 'banned' else 'active' end;

  insert into public.account_moderation (auth_id, state, reason, moderated_by, updated_at)
  values (p_auth_id, v_state, p_reason, auth.uid(), now())
  on conflict (auth_id) do update
    set state = excluded.state, reason = excluded.reason,
        moderated_by = excluded.moderated_by, updated_at = now();

  update auth.users
     set banned_until = case when p_action = 'unban' then null else 'infinity'::timestamptz end
   where id = p_auth_id;

  -- 本人への通知（説明の機会＝理由と申し立て先を必ず伝える）
  v_label := case p_action when 'suspend' then '一時停止' when 'ban' then '停止' else '再開' end;
  begin
    if p_action = 'unban' then
      perform public.send_user_email(p_auth_id,
        '[chitose-bank] アカウントの再開のお知らせ',
        'あなたのアカウントの利用を再開しました。' || E'\n' ||
        'ご協力ありがとうございました。' || E'\n\n' ||
        'https://chitose-bank.com');
    else
      perform public.send_user_email(p_auth_id,
        '[chitose-bank] アカウントの' || v_label || 'について（重要）',
        'あなたのアカウントの利用を' || v_label || 'しました。' || E'\n\n' ||
        '■ 理由：' || E'\n' || coalesce(nullif(p_reason,''), '利用規約に違反する行為が確認されたため') || E'\n\n' ||
        '■ この決定に対する申し立てについて：' || E'\n' ||
        'この決定に心当たりがない場合や、事情の説明を希望する場合は、' || E'\n' ||
        'このメールに返信するか、次の窓口までご連絡ください。' || E'\n' ||
        '内容を確認のうえ、必ずお返事します。' || E'\n' ||
        '窓口：t5fki6643qty@gmail.com' || E'\n\n' ||
        '■ あなたの応募・評価・契約の記録は削除されず、保存されています。');
    end if;
  exception when others then null; end;

  return json_build_object('ok', true, 'state', v_state);
end; $function$
;
CREATE OR REPLACE FUNCTION public.admin_working_jobs()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_working json;
  v_upcoming json;
  v_expired json;
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;

  select coalesce(json_agg(row order by started_at_raw asc nulls last), '[]'::json) into v_working
  from (
    select
      json_build_object(
        'application_id', a.id,
        'job_number', a.job_number,
        'worker_id', a.worker_id,
        'farmer_id', a.farmer_id,
        'worker_name', wp.nickname,
        'farmer_name', ep.nickname,
        'crop', j.crop,
        'task', j.task,
        'prefecture', j.prefecture,
        'city', j.city,
        'date_label', j.date_label,
        'date_start', j.date_start,
        'date_end', j.date_end,
        'agreed_dates', a.agreed_dates,
        'auto_started', a.auto_started,
        'attended', a.attended,
        'started_at', to_char(a.started_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'work_completed_at', to_char(a.work_completed_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'insurance_prepared_at', to_char(a.insurance_prepared_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI')
      ) as row,
      a.started_at as started_at_raw
    from public.applications a
    left join public.jobs j on j.job_number = a.job_number
    left join public.worker_profiles wp on wp.auth_id = a.worker_id
    left join public.employer_profiles ep on ep.auth_id = a.farmer_id
    where a.status = 'working'
  ) t;

  select coalesce(json_agg(row order by ord_date asc nulls last), '[]'::json) into v_upcoming
  from (
    select
      json_build_object(
        'application_id', a.id,
        'job_number', a.job_number,
        'worker_id', a.worker_id,
        'farmer_id', a.farmer_id,
        'worker_name', wp.nickname,
        'farmer_name', ep.nickname,
        'crop', j.crop,
        'task', j.task,
        'prefecture', j.prefecture,
        'city', j.city,
        'date_label', j.date_label,
        'date_start', j.date_start,
        'date_end', j.date_end,
        'agreed_dates', a.agreed_dates,
        'insurance_prepared_at', to_char(a.insurance_prepared_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'hired_at', to_char(greatest(a.terms_confirmed_worker_at, a.terms_confirmed_farmer_at) at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI')
      ) as row,
      j.date_start as ord_date
    from public.applications a
    left join public.jobs j on j.job_number = a.job_number
    left join public.worker_profiles wp on wp.auth_id = a.worker_id
    left join public.employer_profiles ep on ep.auth_id = a.farmer_id
    where a.status = 'approved'
      and a.terms_confirmed_worker_at is not null
      and a.terms_confirmed_farmer_at is not null
      and a.started_at is null
  ) t;

  select coalesce(json_agg(row order by ord_ts desc nulls last), '[]'::json) into v_expired
  from (
    select
      json_build_object(
        'application_id', a.id,
        'job_number', a.job_number,
        'worker_id', a.worker_id,
        'farmer_id', a.farmer_id,
        'worker_name', wp.nickname,
        'farmer_name', ep.nickname,
        'crop', j.crop,
        'task', j.task,
        'prefecture', j.prefecture,
        'city', j.city,
        'date_label', j.date_label,
        'date_start', j.date_start,
        'date_end', j.date_end,
        'agreed_dates', a.agreed_dates,
        'available_dates', a.available_dates,
        'was_approved', exists (
          select 1 from public.event_audit ev
           where ev.table_name = 'applications' and ev.row_pk = a.id::text
             and ev.diff->'status'->>'new' = 'expired'
             and ev.diff->'status'->>'old' = 'approved'),
        'applied_at', to_char(a.created_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'expired_at', to_char(a.decided_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI')
      ) as row,
      a.decided_at as ord_ts
    from public.applications a
    left join public.jobs j on j.job_number = a.job_number
    left join public.worker_profiles wp on wp.auth_id = a.worker_id
    left join public.employer_profiles ep on ep.auth_id = a.farmer_id
    where a.status = 'expired'
      and a.decided_at >= now() - interval '14 days'
  ) t;

  return json_build_object('ok', true, 'working', v_working, 'upcoming', v_upcoming, 'expired_watch', v_expired);
end; $function$
;
CREATE OR REPLACE FUNCTION public.admin_worker_list()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_workers json;
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;

  select coalesce(json_agg(json_build_object(
           'worker_id', t.worker_id,
           'name', t.name,
           'completed_count', t.completed_count,
           'absent_count', t.absent_count,
           'total_minutes', t.total_minutes)
         order by t.completed_count desc, t.name asc), '[]'::json)
    into v_workers
  from (
    select a.worker_id,
           max(wp.nickname) as name,
           count(*) filter (where a.status = 'completed' and a.attended is distinct from false) as completed_count,
           count(*) filter (where a.status = 'completed' and a.attended is false) as absent_count,
           coalesce(sum(public.app_accrued_minutes(a.id))
                    filter (where a.attended is distinct from false), 0)::int as total_minutes
      from public.applications a
      left join public.jobs j on j.job_number = a.job_number
      left join public.worker_profiles wp on wp.auth_id = a.worker_id
     where a.status in ('working','completed')
     group by a.worker_id
  ) t;
  return json_build_object('ok', true, 'workers', v_workers);
end; $function$
;
CREATE OR REPLACE FUNCTION public.count_job_view(p_job_number integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_farmer uuid;
  v_status text;
  v_salt   text;
  v_key    text;
  v_today  date;
begin
  if p_job_number is null then return; end if;
  -- 未ログインは数えない（ログアウトして自分の求人を増やす道を塞ぐ）
  if auth.uid() is null then return; end if;

  select j.farmer_id, j.status into v_farmer, v_status
    from public.jobs j where j.job_number = p_job_number;
  if v_farmer is null then return; end if;
  -- 公開面に出る求人だけ（下書き・審査中は数えない）
  if v_status not in ('open','closed') then return; end if;
  -- 自分の求人は数えない／運営の見回りも数えない（先例 count_worker_profile_view と同じ規則）
  if auth.uid() = v_farmer then return; end if;
  if public.is_app_admin() then return; end if;

  -- 同じアカウント×同じ求人は30日に1回だけ（印が無い時は失敗側に倒す＝数えない）
  select s.value into v_salt from public.app_settings s where s.key = 'job_view_mark_salt';
  if v_salt is null or v_salt = '' then return; end if;
  v_key   := encode(extensions.digest(auth.uid()::text || ':' || p_job_number::text || ':' || v_salt, 'sha256'), 'hex');
  v_today := (now() at time zone 'Asia/Tokyo')::date;

  insert into public.job_view_marks (job_number, viewer_key, seen_on)
       values (p_job_number, v_key, v_today)
  on conflict (job_number, viewer_key) do update
    set seen_on = excluded.seen_on
    where public.job_view_marks.seen_on <= excluded.seen_on - 30;
  -- 印が新しく置かれた／30日を過ぎて置き直された時だけ FOUND＝それ以外は数えない
  if not found then return; end if;

  insert into public.job_view_counts (job_number, view_count, updated_at)
       values (p_job_number, 1, now())
  on conflict (job_number) do update
    set view_count = public.job_view_counts.view_count + 1, updated_at = now();
end $function$
;
CREATE OR REPLACE FUNCTION public.admin_work_reviews(p_direction text DEFAULT 'worker_to_farmer'::text, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_items jsonb;
begin
  if auth.uid() is null or not public.is_app_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if p_direction is null or p_direction not in ('worker_to_farmer','farmer_to_worker') or p_offset is null or p_offset < 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc, t.id desc), '[]'::jsonb) into v_items
  from (
    select r.id, r.application_id, r.direction, r.created_at,
      a.job_number, a.work_completed_at, j.crop, j.task,
      wp.nickname as worker_name, ep.nickname as farmer_name,
      r.as_described, r.instructions_clear, r.safety_care, r.paid_as_posted, r.want_again,
      r.match_level, r.pay_status, r.want_again_choice,
      r.work_outcome, r.traits, r.completed_work, r.followed_instructions, r.entrust, r.on_time
    from public.reviews r
    join public.applications a on a.id = r.application_id
    left join public.jobs j on j.job_number = a.job_number
    left join public.worker_profiles wp on wp.auth_id = a.worker_id
    left join public.employer_profiles ep on ep.auth_id = a.farmer_id
    where r.direction = p_direction and (a.work_completed_at is not null or a.status = 'completed')
    order by r.created_at desc, r.id desc limit 31 offset p_offset
  ) t;
  return jsonb_build_object('ok', true, 'items', v_items - 30, 'has_more', jsonb_array_length(v_items) > 30);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.request_job_revision(p_job_number integer, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_farmer uuid; v_status text; v_ref text;
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    return json_build_object('ok', false, 'reason', 'reason_required');
  end if;
  select farmer_id, status into v_farmer, v_status from public.jobs where job_number = p_job_number;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_status not in ('pending','open') then
    return json_build_object('ok', false, 'reason', 'not_revisable', 'status', v_status);
  end if;
  v_ref := public.job_ref(p_job_number,'farmer');
  update public.jobs set status = 'draft', revision_requested_at = now() where job_number = p_job_number;
  insert into public.notifications (farmer_id, type, message)
  values (v_farmer, 'job_revision_requested',
          'あなたの求人 #' || p_job_number || ' の修正をお願いします：' || p_reason);
  begin
    perform public.send_user_email(v_farmer,
      '[chitose-bank] あなたの求人 #' || p_job_number || ' の修正のお願い',
      '■ ' || v_ref || E'\n\n' ||
      '確認の結果、以下の点の修正をお願いすることになりました。' || E'\n\n' ||
      '■ 修正をお願いする点：' || E'\n' || p_reason || E'\n\n' ||
      '求人は「作成中」に戻しています。修正のうえ、もう一度掲載してください。' || E'\n' ||
      '（内容の正確な表示のためのお願いであり、採否には一切関与しません）' || E'\n\n' ||
      '▶ この求人の修正はこちら：https://chitose-bank.com/#/work/edit/' || p_job_number);
  exception when others then null; end;
  return json_build_object('ok', true);
end; $function$
;
CREATE OR REPLACE FUNCTION public.admin_preview_job(p_job_number integer)
 RETURNS SETOF jobs_public
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_app_admin() then
    return;
  end if;
  return query
    select j.job_number, j.crop, j.task, j.prefecture, j.city, j.town,
           j.date_label, j.date_start, j.date_end, j.headcount,
           j.pay_type, j.hourly_wage, j.daily_wage, j.work_time, j.break_time,
           j.nearest_station, j.commute_time, j.job_exp, j.notes, j.belongings, j.cautions,
           j.danger_places, j.danger_tasks, j.photos, j.created_at,
           j.lat, j.lng, j.geo_radius_m,
           j.full_pay_guarantee, j.beginner_ok, j.instant_approve_repeat,
           j.opened_at, j.perks, j.experienced_preferred,
           (select count(*) from public.applications a
             where a.job_number = j.job_number
               and a.terms_confirmed_worker_at is not null
               and a.terms_confirmed_farmer_at is not null) as hired_count,
           ep.nickname, ep.avatar_url,
           j.recruiter_name, j.recruiter_address, j.recruiter_contact, j.address,
           j.insurance_snapshot, j.profile_snapshot_at,
           j.pay_method, j.pay_timing, j.wage_closing_rule,
           j.holidays,
           (j.address is not null and btrim(j.address) <> ''),
           j.overtime_policy, j.overtime_detail,
           j.status,
           array[]::text[],
           j.place_change_scope,
           j.task_change_scope,
           j.contract_renewal,
           j.retirement_terms,
           j.labor_insurance_status
      from public.jobs j
      left join public.employer_profiles ep on ep.auth_id = j.farmer_id
     where j.job_number = p_job_number;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.request_profile_revision(p_auth_id uuid, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_pr text; v_nickname text;
begin
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    return json_build_object('ok', false, 'reason', 'reason_required');
  end if;

  select pr, nickname into v_pr, v_nickname
    from public.worker_profiles where auth_id = p_auth_id;

  update public.worker_profiles
     set pr_hidden_original = coalesce(pr_hidden_original, v_pr),
         pr = null
   where auth_id = p_auth_id;

  insert into public.notifications (farmer_id, type, message)
  values (p_auth_id, 'profile_revision_requested',
          '自己紹介の修正をお願いします：' || p_reason);
  begin
    perform public.send_user_email(p_auth_id,
      '[chitose-bank] 自己紹介の修正のお願い',
      'ご記入いただいた自己紹介について、以下の点の修正をお願いします。' || E'\n\n' ||
      '■ 修正をお願いする点：' || E'\n' || p_reason || E'\n\n' ||
      '現在、自己紹介は一時的に非表示になっています。' || E'\n' ||
      '修正して保存すると、ふたたび表示されます。' || E'\n\n' ||
      '▶ 修正はこちら：https://chitose-bank.com/#/profile/worker/profile');
  exception when others then null; end;

  return json_build_object('ok', true);
end; $function$
;
CREATE OR REPLACE FUNCTION public.is_job_party(p_job_number integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- party = the job's own farmer / a worker who applied to it (any status) / an admin
  select auth.uid() is not null and (
    exists (select 1 from public.jobs j
             where j.job_number = p_job_number and j.farmer_id = auth.uid())
    or exists (select 1 from public.applications a
                where a.job_number = p_job_number and a.worker_id = auth.uid())
    or public.is_app_admin()
  );
$function$
;
-- Caller IDs cached in local variables use the same membership predicate.
CREATE OR REPLACE FUNCTION public.process_withdrawal(p_auth_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid := auth.uid();
  d jsonb := '{}'::jsonb;
  n int;
begin
  if v_caller is not null and not public.is_app_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  if exists (select 1 from public.app_admins a where a.auth_id = p_auth_id) then
    return json_build_object('ok', false, 'reason', 'target_is_admin');
  end if;
  if not exists (select 1 from auth.users where id = p_auth_id) then
    return json_build_object('ok', false, 'reason', 'user_not_found');
  end if;

  -- (a) 本人の届出情報・行動の好み＝行ごと削除（対象はコメントの列挙と1対1・汎用化しない）
  delete from public.worker_profiles      where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('worker_profiles', n);
  delete from public.employer_profiles    where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('employer_profiles', n);
  delete from public.consignment_profiles where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('consignment_profiles', n);
  delete from public.account_holders      where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('account_holders', n);
  delete from public.emergency_contacts   where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('emergency_contacts', n);
  delete from public.push_subscriptions   where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('push_subscriptions', n);
  delete from public.saved_jobs           where worker_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('saved_jobs', n);
  delete from public.worker_profile_view_counts where worker_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('worker_profile_view_counts', n);
  delete from public.repeat_roster        where farmer_id = p_auth_id or worker_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('repeat_roster', n);
  delete from public.pending_applications where worker_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('pending_applications', n);
  delete from public.chat_reads           where reader_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('chat_reads', n);
  delete from public.notifications        where farmer_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('notifications', n);
  delete from public.page_events          where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('page_events', n);
  delete from public.auth_logs            where farmer_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('auth_logs', n);
  delete from public.farmers              where auth_id  = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('farmers', n);
  delete from public.records              where farmer_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('records', n);
  delete from public.user_onboarding_survey where auth_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('user_onboarding_survey', n);
  delete from public.feedback             where reporter_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object('feedback', n);

  -- 退会農家の公開中/審査中の求人を掲載終了に（2026-08-07 X4）：行は消さず応募受付だけ止める。
  -- draftは公開されていないので対象外。過去求人の証跡（応募・はたらいた記録）は残す。
  update public.jobs set status = 'closed' where farmer_id = p_auth_id and status in ('open','pending');
  get diagnostics n = row_count; d := d || jsonb_build_object('jobs_closed', n);

  -- (b) メールの削除＝匿名化（行は残す・FKと証跡は無傷）
  update auth.users set
    email = 'withdrawn+' || p_auth_id || '@withdrawn.invalid',
    encrypted_password = '',
    raw_user_meta_data = '{}'::jsonb,
    phone = null,
    email_change = '',
    email_change_token_new = '',
    confirmation_token = '',
    recovery_token = '',
    banned_until = 'infinity'
  where id = p_auth_id;
  delete from auth.identities      where user_id = p_auth_id;
  delete from auth.sessions        where user_id = p_auth_id;
  delete from auth.one_time_tokens where user_id = p_auth_id;
  delete from auth.mfa_factors     where user_id = p_auth_id;

  -- (c) 退会処理の記録（冪等・2026-08-07 W4修正）：申請行があれば processed_at を刻む／無ければ1行作る。
  if exists (select 1 from public.withdrawal_requests where auth_id = p_auth_id) then
    update public.withdrawal_requests set processed_at = coalesce(processed_at, now())
     where auth_id = p_auth_id;
  else
    insert into public.withdrawal_requests (auth_id, requested_at, processed_at)
    values (p_auth_id, now(), now());
  end if;

  return json_build_object('ok', true, 'deleted', d,
    'note', 'アイコン画像（avatars/' || p_auth_id || '/）はストレージAPIから手動で削除すること（SQL削除はプラットフォームで禁止）。');
end $function$
;
CREATE OR REPLACE FUNCTION public.save_my_consignment_aux(p_owner uuid, p_operation text, p_id uuid, p_expected jsonb, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_uid uuid:=auth.uid();
  v_field public.consignment_fields%rowtype;
  v_profile public.consignment_profiles%rowtype;
  v_deal public.consignment_deals%rowtype;
  v_progress public.consignment_progress%rowtype;
  v_row jsonb;
  v_base jsonb;
  v_action text;
  v_from text;
  v_to text;
  v_date date;
  v_found boolean;
begin
  if v_uid is null or p_owner is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  if not public.is_app_admin() then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if p_id is null or p_operation is null or p_operation not in ('field_save','field_delete','lend','terms','advance','progress')
    or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>262144 then
    return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('consignment-aux:'||p_id::text,0));
  if p_operation in ('field_save','field_delete') then
    select * into v_field from public.consignment_fields where id=p_id for update;
    v_found:=found;
    if v_found and v_field.auth_id is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_owner'); end if;
    v_base:=case when v_found then jsonb_build_object('name',v_field.name,'region',v_field.region,'area_a',v_field.area_a,'data',v_field.data,'updated_at',v_field.updated_at) else null end;
    if p_expected is not null then p_expected:=p_expected||jsonb_build_object('updated_at',(p_expected->>'updated_at')::timestamptz); end if;
    if p_operation='field_delete' then
      if p_input<>'{}'::jsonb then return jsonb_build_object('ok',false,'reason','invalid_input'); end if;
      if v_found and v_base is distinct from p_expected then return jsonb_build_object('ok',false,'reason','conflict'); end if;
      if v_found then delete from public.consignment_fields where id=p_id returning * into v_field; if not found then raise exception 'FIELD_DELETE_NOT_SAVED'; end if; end if;
      v_row:='null'::jsonb;
    else
      if not(p_input ?& array['name','region','area_a','data']) or p_input-array['name','region','area_a','data']<>'{}'::jsonb
        or exists(select 1 from jsonb_each(p_input-array['data']) where jsonb_typeof(value) is distinct from 'string')
        or nullif(btrim(p_input->>'name'),'') is null or jsonb_typeof(p_input->'data') is distinct from 'object' then
        return jsonb_build_object('ok',false,'reason','invalid_input');
      end if;
      if not(v_found and v_base-'updated_at'=p_input) then
        if v_base is distinct from p_expected then return jsonb_build_object('ok',false,'reason','conflict'); end if;
        if v_found then
          update public.consignment_fields set name=p_input->>'name',region=p_input->>'region',area_a=p_input->>'area_a',data=p_input->'data',updated_at=clock_timestamp()
            where id=p_id and auth_id=v_uid returning * into v_field;
        else
          insert into public.consignment_fields(id,auth_id,name,region,area_a,data) values(p_id,v_uid,p_input->>'name',p_input->>'region',p_input->>'area_a',p_input->'data') returning * into v_field;
        end if;
        if v_field.id is null then raise exception 'FIELD_NOT_SAVED'; end if;
      end if;
      v_row:=to_jsonb(v_field);
    end if;
  elsif p_operation in ('lend','terms') then
    if p_id is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_owner'); end if;
    -- The existing consignor/profile writers also lock this owner or row.
    perform pg_advisory_xact_lock(hashtextextended('consignor:'||v_uid::text,0));
    select * into v_profile from public.consignment_profiles where auth_id=v_uid for update;
    v_found:=found;
    if p_operation='lend' then
      if p_input - 'items'<>'{}'::jsonb or jsonb_typeof(p_input->'items') is distinct from 'array'
        or jsonb_array_length(p_input->'items')>500 or exists(select 1 from jsonb_array_elements(p_input->'items') x
        where jsonb_typeof(x)<>'object' or x-array['k','n']<>'{}'::jsonb or jsonb_typeof(x->'k') is distinct from 'string' or jsonb_typeof(x->'n') is distinct from 'string' or nullif(btrim(x->>'n'),'') is null) then
        return jsonb_build_object('ok',false,'reason','invalid_input');
      end if;
      if coalesce(v_profile.consignor_data->'cmn_lend_items','null'::jsonb) is distinct from p_input->'items' then
        if coalesce(v_profile.consignor_data->'cmn_lend_items','null'::jsonb) is distinct from coalesce(p_expected,'null'::jsonb) then return jsonb_build_object('ok',false,'reason','conflict'); end if;
        if v_found then update public.consignment_profiles set consignor_data=jsonb_set(consignor_data,'{cmn_lend_items}',p_input->'items'),updated_at=clock_timestamp() where auth_id=v_uid returning * into v_profile;
        else insert into public.consignment_profiles(auth_id,consignor_data) values(v_uid,jsonb_build_object('cmn_lend_items',p_input->'items')) returning * into v_profile; end if;
      end if;
    else
      if p_input is distinct from jsonb_build_object('version','consignment-terms-v1-2026-08') then return jsonb_build_object('ok',false,'reason','invalid_input'); end if;
      if not coalesce(v_profile.consignment_terms_consent and v_profile.consignment_terms_consent_version=p_input->>'version',false) then
        insert into public.consignment_profiles(auth_id,consignment_terms_consent,consignment_terms_consent_at,consignment_terms_consent_version,consignment_terms_consent_user_id)
        values(v_uid,true,clock_timestamp(),p_input->>'version',v_uid) on conflict(auth_id) do update set consignment_terms_consent=true,
          consignment_terms_consent_at=excluded.consignment_terms_consent_at,consignment_terms_consent_version=excluded.consignment_terms_consent_version,
          consignment_terms_consent_user_id=v_uid,updated_at=clock_timestamp() returning * into v_profile;
      end if;
    end if;
    if v_profile.auth_id is null then raise exception 'PROFILE_NOT_SAVED'; end if;
    v_row:=to_jsonb(v_profile);
  elsif p_operation='progress' then
    if not(p_input ?& array['deal_id','work_date','hours','workers','yield_boxes','note']) or p_input-array['deal_id','work_date','hours','workers','yield_boxes','note']<>'{}'::jsonb
      or jsonb_typeof(p_input->'note') is distinct from 'string' or p_input->>'work_date' is null or not isfinite((p_input->>'work_date')::date)
      or exists(select 1 from jsonb_each(p_input) where key in ('hours','workers','yield_boxes') and value<>'null'::jsonb and (jsonb_typeof(value)<>'number' or (value::text)::numeric<0))
      or (p_input->>'workers')::numeric is distinct from trunc((p_input->>'workers')::numeric)
      or (p_input->>'yield_boxes')::numeric is distinct from trunc((p_input->>'yield_boxes')::numeric) then
      return jsonb_build_object('ok',false,'reason','invalid_input');
    end if;
    select * into v_deal from public.consignment_deals where id=(p_input->>'deal_id')::uuid for update;
    if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
    select * into v_progress from public.consignment_progress where id=p_id;
    v_found:=found;
    if not v_found then
      insert into public.consignment_progress(id,deal_id,work_date,hours,workers,yield_boxes,note) values(p_id,v_deal.id,(p_input->>'work_date')::date,
        (p_input->>'hours')::numeric,(p_input->>'workers')::integer,(p_input->>'yield_boxes')::integer,p_input->>'note') returning * into v_progress;
      if v_progress.id is null then raise exception 'PROGRESS_NOT_SAVED'; end if;
    end if;
    if to_jsonb(v_progress)-array['id','created_at'] is distinct from p_input then
      if not v_found then raise exception 'PROGRESS_NOT_CONFIRMED'; end if;
      return jsonb_build_object('ok',false,'reason','conflict');
    end if;
    v_row:=to_jsonb(v_progress);
  else
    if not(p_input ?& array['action','date','note']) or p_input-array['action','date','note']<>'{}'::jsonb
      or jsonb_typeof(p_input->'note') is distinct from 'string' then return jsonb_build_object('ok',false,'reason','invalid_input'); end if;
    v_action:=p_input->>'action';v_date:=(p_input->>'date')::date;
    if v_action is null or v_action not in ('agree','deposit','start','inspect','pay','complete') or v_date is null or not isfinite(v_date) then return jsonb_build_object('ok',false,'reason','invalid_input'); end if;
    select * into v_deal from public.consignment_deals where id=p_id for update;
    if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
    v_from:=case v_action when 'agree' then 'draft' when 'deposit' then 'agreed' when 'start' then 'agreed' when 'inspect' then 'working' when 'pay' then 'inspected' when 'complete' then 'paid' end;
    v_to:=case v_action when 'agree' then 'agreed' when 'deposit' then 'agreed' when 'start' then 'working' when 'inspect' then 'inspected' when 'pay' then 'paid' when 'complete' then 'done' end;
    if not coalesce(v_deal.status=v_to and case v_action when 'deposit' then v_deal.spec->>'deposit_received_at'=v_date::text
      when 'inspect' then v_deal.inspected_at=v_date and coalesce(v_deal.notes,'')=p_input->>'note'
      when 'pay' then v_deal.paid_at=v_date when 'complete' then v_deal.spec->>'reflection'=p_input->>'note' else true end,false) then
      if v_deal.status is distinct from v_from or v_deal.updated_at is distinct from (p_expected->>'updated_at')::timestamptz then return jsonb_build_object('ok',false,'reason','conflict'); end if;
      update public.consignment_deals set status=v_to,
        spec=case v_action when 'deposit' then jsonb_set(spec,'{deposit_received_at}',to_jsonb(v_date::text)) when 'complete' then jsonb_set(spec,'{reflection}',p_input->'note') else spec end,
        inspected_at=case when v_action='inspect' then v_date else inspected_at end,
        paid_at=case when v_action='pay' then v_date else paid_at end,
        notes=case when v_action='inspect' then nullif(p_input->>'note','') else notes end
        where id=p_id returning * into v_deal;
      if v_deal.id is null then raise exception 'DEAL_NOT_SAVED'; end if;
    end if;
    v_row:=to_jsonb(v_deal);
  end if;
  return jsonb_build_object('ok',true,'owner',v_uid,'operation',p_operation,'id',p_id,'input',p_input,'row',v_row);
exception when others then
  return jsonb_build_object('ok',false,'reason','save_rejected','code',sqlstate);
end $function$
;
CREATE OR REPLACE FUNCTION private.can_read_listing_photo(p_bucket text, p_name text, p_owner text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_url text;
begin
  if v_uid is null or p_bucket not in ('job-photos','consignment-photos') then return false; end if;
  if public.is_app_admin() then return true; end if;
  if p_owner = v_uid::text then return true; end if;
  if exists (select 1 from private.listing_photo_legacy_access l
    where l.bucket_id=p_bucket and l.object_name=p_name and l.farmer_id=v_uid) then return true; end if;

  -- Consignment records are administrator-only today. Do not invent a public
  -- photo permission for those otherwise private records.
  if p_bucket <> 'job-photos' then return false; end if;
  -- Non-owners may download an entitled photo, never enumerate or sign it.
  if not storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info']) then return false; end if;
  v_url := 'https://aegwepgtmwcnwzybpgsh.supabase.co/storage/v1/object/public/' || p_bucket || '/' || p_name;
  return exists (
    select 1 from public.jobs j
    where j.status in ('open','closed')
      and (p_owner = j.farmer_id::text or exists (
        select 1 from private.listing_photo_legacy_access l
        where l.bucket_id=p_bucket and l.object_name=p_name and l.farmer_id=j.farmer_id))
      and exists (select 1 from private.listing_photo_urls(j.photos,j.danger_places,j.danger_tasks) u(url) where u.url=v_url)
      and (
        (j.unlisted_reason is null and not public.is_account_moderated(j.farmer_id)
          and (j.status='open' or (j.headcount > 0 and
            (select count(*) from public.applications a where a.job_number=j.job_number
              and a.terms_confirmed_worker_at is not null and a.terms_confirmed_farmer_at is not null) >= j.headcount)))
        or exists (select 1 from public.applications a where a.job_number=j.job_number and a.worker_id=v_uid
          and a.status in ('applied','approved','meeting','interview','contracted','working','completed'))
      )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.save_consignment_bundle(p_owner uuid, p_request_id uuid, p_deal_id uuid, p_expected jsonb, p_patch jsonb, p_expected_field jsonb, p_terms jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_deal public.consignment_deals%rowtype;
  v_field public.consignment_fields%rowtype;
  v_profile public.consignment_profiles%rowtype;
  v_previous private.consignment_save_requests%rowtype;
  v_request jsonb;
  v_result jsonb;
  v_base jsonb;
  v_data jsonb;
  v_name text;
  v_area text;
  v_key text;
  v_value text;
  v_found boolean;
begin
  if v_uid is null or p_owner is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  if not public.is_app_admin() then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if p_request_id is null or p_deal_id is null
    or jsonb_typeof(p_patch) is distinct from 'object' or jsonb_typeof(p_terms) is distinct from 'object'
    or jsonb_typeof(p_patch->'spec') is distinct from 'object'
    or jsonb_typeof(p_patch->'status') is distinct from 'string'
    or p_patch->>'status' not in ('draft','agreed','working','inspected','paid','done')
    or not (p_patch ?& array['spec','status','notes']) or p_patch - array['spec','status','notes'] <> '{}'::jsonb
    or (p_patch->'notes' <> 'null'::jsonb and jsonb_typeof(p_patch->'notes') is distinct from 'string')
    or octet_length(p_patch::text)>524288 or octet_length(p_terms::text)>32768
    or p_terms - array['cmn_pay_due','cmn_fee_bearer','cmn_inspect','cmn_cancel'] <> '{}'::jsonb
    or exists(select 1 from jsonb_each(p_terms) where jsonb_typeof(value) is distinct from 'string') then
    return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  if p_expected is not null and (jsonb_typeof(p_expected) is distinct from 'object'
    or not (p_expected ?& array['spec','status','notes','updated_at'])
    or p_expected - array['spec','status','notes','updated_at'] <> '{}'::jsonb) then
    return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  if p_expected_field is not null and (jsonb_typeof(p_expected_field) is distinct from 'object'
    or jsonb_typeof(p_expected_field->'area_a') is distinct from 'string'
    or p_expected_field - 'area_a' <> '{}'::jsonb) then
    return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  if jsonb_typeof(p_patch->'spec'->'photos') is distinct from 'array' then
    return jsonb_build_object('ok',false,'reason','photos_required');
  end if;
  if jsonb_array_length(p_patch->'spec'->'photos')<3 then return jsonb_build_object('ok',false,'reason','photos_required'); end if;
  -- 日時の表記差を正規化。無効日時も変更前に拒否される。
  if p_expected is not null then
    if p_expected->>'updated_at' is null or not isfinite((p_expected->>'updated_at')::timestamptz) then
      return jsonb_build_object('ok',false,'reason','invalid_input');
    end if;
    p_expected := p_expected || jsonb_build_object('updated_at',(p_expected->>'updated_at')::timestamptz);
  end if;
  v_request := jsonb_build_object('deal_id',p_deal_id,'expected',p_expected,'patch',p_patch,'field',p_expected_field,'terms',p_terms);
  perform pg_advisory_xact_lock(hashtextextended('consignment-save:'||p_request_id::text,0));
  select * into v_previous from private.consignment_save_requests where id=p_request_id;
  if found then
    if v_previous.actor_id is distinct from v_uid or v_previous.request is distinct from v_request then
      return jsonb_build_object('ok',false,'reason','request_mismatch');
    end if;
    -- 当時確定した行を返す。他の端末の後続変更を再保存・取り込みしない。
    return v_previous.result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('consignment-deal:'||p_deal_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('consignor:'||v_uid::text,0));
  select * into v_deal from public.consignment_deals where id=p_deal_id for update;
  v_found := found;
  if v_found then
    v_base := jsonb_build_object('spec',v_deal.spec,'status',v_deal.status,'notes',v_deal.notes,'updated_at',v_deal.updated_at);
    if v_base is distinct from p_expected then return jsonb_build_object('ok',false,'reason','conflict'); end if;
  elsif p_expected is not null then return jsonb_build_object('ok',false,'reason','not_found');
  elsif p_patch->>'status' <> 'draft' then return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  v_name := btrim(coalesce(p_patch->'spec'->>'field_name',''));
  v_area := btrim(coalesce(p_patch->'spec'->>'area_a',''));
  if v_name<>'' then
    select * into v_field from public.consignment_fields where auth_id=v_uid and name=v_name for update;
    if found then
      if v_field.area_a is distinct from v_area and jsonb_build_object('area_a',v_field.area_a) is distinct from p_expected_field then
        return jsonb_build_object('ok',false,'reason','field_conflict');
      end if;
    elsif p_expected_field is not null then return jsonb_build_object('ok',false,'reason','field_conflict'); end if;
  end if;
  select * into v_profile from public.consignment_profiles where auth_id=v_uid for update;
  v_data := coalesce(v_profile.consignor_data,'{}'::jsonb);
  for v_key,v_value in select key,btrim(value #>> '{}') from jsonb_each(p_terms) loop
    if v_value<>'' then
      if btrim(coalesce(v_data->>v_key,''))<>'' and btrim(v_data->>v_key)<>v_value then
        return jsonb_build_object('ok',false,'reason','terms_conflict');
      end if;
      if btrim(coalesce(v_data->>v_key,''))='' then v_data:=jsonb_set(v_data,array[v_key],to_jsonb(v_value)); end if;
    end if;
  end loop;
  begin
    if v_found then
      update public.consignment_deals set spec=p_patch->'spec',status=p_patch->>'status',notes=p_patch->>'notes',updated_at=now()
        where id=p_deal_id returning * into v_deal;
    else
      insert into public.consignment_deals(id,spec,status,notes)
        values(p_deal_id,p_patch->'spec',p_patch->>'status',p_patch->>'notes') returning * into v_deal;
    end if;
    if v_deal.id is null then raise exception 'DEAL_NOT_SAVED'; end if;
    if v_name<>'' then
      if v_field.id is null then
        insert into public.consignment_fields(auth_id,name,region,area_a)
          values(v_uid,v_name,btrim(coalesce(p_patch->'spec'->>'region','')),v_area) returning * into v_field;
      else
        update public.consignment_fields set area_a=v_area,updated_at=now() where id=v_field.id returning * into v_field;
      end if;
      if v_field.id is null then raise exception 'FIELD_NOT_SAVED'; end if;
    end if;
    if v_data is distinct from coalesce(v_profile.consignor_data,'{}'::jsonb) then
      insert into public.consignment_profiles(auth_id,consignor_data) values(v_uid,v_data)
        on conflict(auth_id) do update set consignor_data=excluded.consignor_data,updated_at=now() returning * into v_profile;
      if v_profile.auth_id is null then raise exception 'TERMS_NOT_SAVED'; end if;
    end if;
    v_result:=jsonb_build_object('ok',true,'request_id',p_request_id,'owner',v_uid,'row',to_jsonb(v_deal),
      'field',case when v_field.id is null then null else to_jsonb(v_field) end,
      'profile',case when v_profile.auth_id is null then null else to_jsonb(v_profile) end);
    insert into private.consignment_save_requests(id,actor_id,deal_id,request,result) values(p_request_id,v_uid,p_deal_id,v_request,v_result);
    return v_result;
  exception when others then
    return jsonb_build_object('ok',false,'reason','save_rejected','code',sqlstate);
  end;
end $function$
;
CREATE OR REPLACE FUNCTION public.save_help_image_reference(p_owner uuid, p_slot text, p_expected jsonb, p_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_before public.help_images%rowtype;
  v_after public.help_images%rowtype;
  v_base jsonb;
  v_count integer;
begin
  if v_uid is null or p_owner is distinct from v_uid then return jsonb_build_object('ok',false,'reason','not_logged_in'); end if;
  if not public.is_app_admin() then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if p_slot is null or p_slot !~ '^[a-zA-Z0-9_-]{1,120}$'
    or (p_url is not null and (length(p_url)>2048 or p_url !~ '^https://[^/]+/storage/v1/object/public/help-images/v2/[a-zA-Z0-9_-]+/[0-9a-f-]+\.(jpg|png|webp|gif)$')) then
    return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;
  if p_expected is not null then
    if jsonb_typeof(p_expected) is distinct from 'object' or not (p_expected ?& array['url','updated_at'])
      or p_expected - array['url','updated_at'] <> '{}'::jsonb or jsonb_typeof(p_expected->'url') is distinct from 'string'
      or p_expected->>'updated_at' is null then return jsonb_build_object('ok',false,'reason','invalid_input'); end if;
    p_expected := p_expected || jsonb_build_object('updated_at',(p_expected->>'updated_at')::timestamptz);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('help-image:'||p_slot,0));
  select * into v_before from public.help_images where slot_key=p_slot for update;
  if found then
    v_base:=jsonb_build_object('url',v_before.url,'updated_at',v_before.updated_at);
    if v_before.url=p_url then return jsonb_build_object('ok',true,'row',to_jsonb(v_before)); end if;
  elsif p_url is null then return jsonb_build_object('ok',true,'row',null);
  end if;
  if v_base is distinct from p_expected then return jsonb_build_object('ok',false,'reason','conflict'); end if;
  if p_url is null then
    delete from public.help_images where slot_key=p_slot;
    get diagnostics v_count=row_count;
    if v_count<>1 then raise exception 'HELP_IMAGE_DELETE_NOT_CONFIRMED'; end if;
    return jsonb_build_object('ok',true,'row',null);
  elsif v_before.slot_key is null then
    insert into public.help_images(slot_key,url) values(p_slot,p_url) returning * into v_after;
  else
    update public.help_images set url=p_url,updated_at=greatest(now(),v_before.updated_at+interval '1 microsecond') where slot_key=p_slot returning * into v_after;
  end if;
  if v_after.slot_key is distinct from p_slot or v_after.url is distinct from p_url then raise exception 'HELP_IMAGE_SAVE_NOT_CONFIRMED'; end if;
  return jsonb_build_object('ok',true,'row',to_jsonb(v_after));
end $function$
;
CREATE OR REPLACE FUNCTION public.admin_attention()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_fix json; v_stall json;
begin
  if v_uid is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  if not public.is_app_admin() then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;

  select json_build_object(
    'errors', coalesce((
      select json_agg(x order by x.latest desc) from (
        select coalesce(nullif(btrim(e.component), ''), '(不明)') as component,
               left(coalesce(nullif(btrim(e.message), ''), '(メッセージなし)'), 160) as message,
               count(*)::int as cnt,
               max(e.created_at) as latest,
               (array_agg(e.page order by e.created_at desc))[1] as page
          from public.app_errors e
         where e.status = 'open'
         group by 1, 2
         order by max(e.created_at) desc
         limit 8
      ) x), '[]'::json),
    'error_total', (select count(*)::int from public.app_errors where status = 'open'),
    'reports_message', (select count(*)::int from public.message_reports where status = 'open'),
    'reports_job',     (select count(*)::int from public.job_reports     where status = 'open'),
    'reports_profile', (select count(*)::int from public.profile_reports where status = 'open'),
    'withdrawals',     (select count(*)::int from public.withdrawal_requests where processed_at is null),
    'feedback_7d',     (select count(*)::int from public.feedback where created_at >= now() - interval '7 days')
  ) into v_fix;

  with applied as (
    select count(*)::int n, max(v_today - created_at::date) d from public.applications where status = 'applied'
  ), pend as (
    select count(*)::int n, max(v_today - created_at::date) d from public.jobs where status = 'pending'
  ), rev as (
    select count(*)::int n, max(v_today - revision_requested_at::date) d
      from public.jobs where status = 'draft' and revision_requested_at is not null
  ), q as (
    select count(*)::int n, max(v_today - created_at::date) d
      from public.job_questions where coalesce(answer, '') = '' and hidden = false
  ), comp as (
    select count(*)::int n from public.applications a join public.jobs j on j.job_number = a.job_number
     where a.status in ('approved','meeting','interview','contracted','working')
       and a.work_completed_at is null
       and coalesce(j.date_end, j.date_start) < v_today
  ), emg as (
    select count(*)::int n from public.attendance_events where created_at >= now() - interval '7 days'
  )
  select json_build_object(
    'applied',      json_build_object('n', applied.n, 'days', applied.d),
    'pending_jobs', json_build_object('n', pend.n,    'days', pend.d),
    'revision',     json_build_object('n', rev.n,     'days', rev.d),
    'questions',    json_build_object('n', q.n,       'days', q.d),
    'complete_missing',  json_build_object('n', comp.n, 'days', null),
    'emergency_7d',      json_build_object('n', emg.n,  'days', null)
  ) into v_stall
  from applied, pend, rev, q, comp, emg;

  return json_build_object('ok', true, 'fix', v_fix, 'stall', v_stall);
end;
$function$
;
commit;
