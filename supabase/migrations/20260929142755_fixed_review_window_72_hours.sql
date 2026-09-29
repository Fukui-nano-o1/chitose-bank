-- 評価は最終作業の終了から72時間だけ受付。双方の提出有無に関係なく締切後に公開する。
-- 予定が分かる仕事は最終作業日の終了時刻を使い、後日の完了操作で受付を延長しない。
alter table public.applications add column if not exists review_opened_at timestamptz;
comment on column public.applications.review_opened_at is '評価受付の固定起点。最終作業終了後の日程編集・完了操作でも変更しない。';

-- 終了済みの仕事は現在の最終終了時刻を固定。評価の既存データは変更・削除しない。
update public.applications a
   set review_opened_at=coalesce(public.app_work_due_at(a.id),a.work_completed_at)
 where a.review_opened_at is null
   and a.status in ('approved','meeting','interview','contracted','working','completed')
   and coalesce(public.app_work_due_at(a.id),a.work_completed_at)<=statement_timestamp();

create or replace function public.trg_app_review_clock()
returns trigger language plpgsql security definer set search_path = ''
as $$ declare v_opened timestamptz;
begin
  if tg_op='INSERT' then new.review_opened_at:=null; return new; end if;
  new.review_opened_at:=old.review_opened_at;
  if old.review_opened_at is null and old.status in ('approved','meeting','interview','contracted','working','completed') then
    v_opened:=coalesce(public.app_work_due_at(old.id),old.work_completed_at);
    if v_opened is null and new.status='completed' then v_opened:=new.work_completed_at; end if;
    if v_opened<=clock_timestamp() then new.review_opened_at:=v_opened; end if;
  end if;
  return new;
end; $$;
revoke all on function public.trg_app_review_clock() from public,anon,authenticated;
create trigger app_review_clock before insert or update of job_number,agreed_dates,work_completed_at,status,review_opened_at
  on public.applications for each row execute function public.trg_app_review_clock();

-- 元の最終日を過ぎた求人を再編集しても、過去の応募の評価窓を動かさない。
create or replace function public.trg_job_review_clock()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if row(new.date_start,new.date_end,new.work_time,new.holidays) is distinct from
     row(old.date_start,old.date_end,old.work_time,old.holidays) then
    update public.applications a set review_opened_at=public.app_work_due_at(a.id)
      where a.job_number=old.job_number and a.review_opened_at is null
        and a.status in ('approved','meeting','interview','contracted','working','completed')
        and public.app_work_due_at(a.id)<=clock_timestamp();
  end if;
  return new;
end; $$;
revoke all on function public.trg_job_review_clock() from public,anon,authenticated;
create trigger job_review_clock before update of date_start,date_end,work_time,holidays
  on public.jobs for each row execute function public.trg_job_review_clock();

create or replace function public.app_review_opened_at(p_app uuid)
returns timestamptz language sql stable security definer set search_path = ''
as $$
  select coalesce(a.review_opened_at,public.app_work_due_at(a.id),a.work_completed_at)
  from public.applications a where a.id=p_app;
$$;
revoke all on function public.app_review_opened_at(uuid) from public,anon,authenticated;

create or replace function public.review_window_state(p_opened_at timestamptz,p_at timestamptz)
returns text language sql immutable security invoker set search_path = ''
as $$ select case when p_opened_at is null then 'unavailable'
  when p_at < p_opened_at then 'not_started'
  when p_at >= p_opened_at + interval '72 hours' then 'closed' else 'open' end; $$;
revoke all on function public.review_window_state(timestamptz,timestamptz) from public,anon,authenticated;

create or replace function public.app_review_accepting(p_app uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.review_window_state(public.app_review_opened_at(p_app),statement_timestamp())='open'; $$;
revoke all on function public.app_review_accepting(uuid) from public,anon,authenticated;

create or replace function public.app_review_published(p_app uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.review_window_state(public.app_review_opened_at(p_app),statement_timestamp())='closed'; $$;
revoke all on function public.app_review_published(uuid) from public,anon,authenticated;

create or replace function public.assert_review_window(p_app uuid)
returns void language plpgsql security definer set search_path = ''
as $$ declare v_state text;
begin
  -- transaction開始時刻now()ではなく、書き込み時点を判定する。
  v_state := public.review_window_state(public.app_review_opened_at(p_app),clock_timestamp());
  if v_state <> 'open' then raise exception using errcode='P0001',message='review_window_'||v_state; end if;
end; $$;
revoke all on function public.assert_review_window(uuid) from public,anon,authenticated;

create or replace function public.review_window(p_application_id uuid)
returns json language plpgsql security definer set search_path = ''
as $$ declare a public.applications; v_opened timestamptz; v_now timestamptz; v_state text;
begin
  select * into a from public.applications where id=p_application_id;
  if auth.uid() is null or a.id is null or (auth.uid() is distinct from a.farmer_id and auth.uid() is distinct from a.worker_id) then
    return json_build_object('ok',false,'reason','not_entitled');
  end if;
  v_opened := public.app_review_opened_at(a.id); v_now := clock_timestamp();
  v_state := public.review_window_state(v_opened,v_now);
  if a.status in ('applied','rejected','expired','canceled') then v_state := 'not_started'; end if;
  if auth.uid()=a.worker_id and public.app_phase(a) not in ('working','completed') then v_state := 'not_started'; end if;
  return json_build_object('ok',true,'state',v_state,'opens_at',v_opened,
    'closes_at',v_opened+interval '72 hours','server_now',v_now);
end; $$;
revoke all on function public.review_window(uuid) from public,anon;
grant execute on function public.review_window(uuid) to authenticated;

create or replace function public.trg_reviews_phase_gate()
returns trigger language plpgsql security definer set search_path = ''
as $$ declare a public.applications;
begin
  if tg_op='UPDATE' then
    -- 公開コメントの運営による非表示は締切後も可能。入力内容や対象の差し替えは不可。
    if (to_jsonb(new)-'comment_status'-'published_at')=(to_jsonb(old)-'comment_status'-'published_at') then return new; end if;
    if new.application_id is distinct from old.application_id
       or new.reviewer_id is distinct from old.reviewer_id
       or new.reviewee_id is distinct from old.reviewee_id
       or new.direction is distinct from old.direction then
      raise exception using errcode='P0001',message='review_identity_immutable';
    end if;
  end if;
  select * into a from public.applications where id=new.application_id for share;
  if a.id is null then raise exception '評価の応募が存在しません'; end if;
  if (new.direction='farmer_to_worker' and public.app_phase(a)<>'completed')
     or (new.direction='worker_to_farmer' and public.app_phase(a) not in ('working','completed')) then
    raise exception using errcode='P0001',message='review_window_not_started';
  end if;
  perform public.assert_review_window(a.id);
  if tg_op='UPDATE' then raise exception using errcode='P0001',message='review_already_submitted'; end if;
  -- バックデートしたcreated_atやpublished_atで制限をすり抜けさせない。
  new.created_at := clock_timestamp(); new.published_at := null;
  return new;
end; $$;
revoke all on function public.trg_reviews_phase_gate() from public,anon,authenticated;
drop trigger if exists reviews_phase_gate on public.reviews;
create trigger reviews_phase_gate before insert or update on public.reviews
for each row execute function public.trg_reviews_phase_gate();

CREATE OR REPLACE FUNCTION public.submit_farmer_final_review(p_application_id uuid, p_work_outcome text, p_want_again_choice text, p_traits jsonb DEFAULT '[]'::jsonb, p_favorite boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v json; v_farmer uuid; v_worker uuid;
begin
  if p_work_outcome is null or p_want_again_choice is null
     or not public.review_traits_valid('farmer_to_worker',p_traits)
     or p_work_outcome not in ('completed','partial','not_completed')
     or p_want_again_choice not in ('yes','neutral','no') then
    return json_build_object('ok', false, 'reason', 'bad_input');
  end if;
  select farmer_id, worker_id into v_farmer, v_worker
    from public.applications where id = p_application_id for update;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if auth.uid() is null or v_farmer is distinct from auth.uid() then return json_build_object('ok', false, 'reason', 'not_yours'); end if;

  -- 古いRPCも、完了・メール・お気に入りの副作用を起こす前に期限を検証する。
  begin
    perform public.assert_review_window(p_application_id);
  exception when sqlstate 'P0001' then
    return json_build_object('ok',false,'reason',sqlerrm);
  end;

  -- 完了処理（評価送信は出勤前提＝欠勤は別の道 complete_work(false)。メール失敗は内側で握って続行）
  v := public.complete_work(p_application_id, true);
  if not coalesce((v->>'ok')::boolean, false) then return v; end if;

  insert into public.reviews (application_id, reviewer_id, reviewee_id, direction,
                              work_outcome, want_again_choice, traits,
                              want_again, completed_work)
  values (p_application_id, v_farmer, v_worker, 'farmer_to_worker',
          p_work_outcome, p_want_again_choice,
          coalesce(p_traits, '[]'::jsonb),
          case p_want_again_choice when 'yes' then true when 'no' then false else null end,
          (p_work_outcome = 'completed'));

  if p_want_again_choice = 'yes' and p_favorite then
    insert into public.repeat_roster (farmer_id, worker_id, source_application_id, notify)
    values (v_farmer, v_worker, p_application_id, true)
    on conflict (farmer_id, worker_id) do nothing;
  end if;

  return json_build_object('ok', true, 'favorited', (p_want_again_choice = 'yes' and p_favorite));
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_farmer_review(p_application_id uuid, p_want_again boolean, p_entrust boolean, p_public_comment text, p_private_memo text, p_favorite boolean, p_on_time boolean DEFAULT NULL::boolean, p_as_described boolean DEFAULT NULL::boolean, p_followed_instructions boolean DEFAULT NULL::boolean, p_completed_work boolean DEFAULT NULL::boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v json; v_farmer uuid; v_worker uuid;
begin
  select farmer_id, worker_id into v_farmer, v_worker
    from public.applications where id = p_application_id for update;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if auth.uid() is null or v_farmer is distinct from auth.uid() then return json_build_object('ok', false, 'reason', 'not_yours'); end if;

  -- 古いRPCも、完了・メール・お気に入りの副作用を起こす前に期限を検証する。
  begin
    perform public.assert_review_window(p_application_id);
  exception when sqlstate 'P0001' then
    return json_build_object('ok',false,'reason',sqlerrm);
  end;

  -- 完了処理（評価送信は出勤前提。メール失敗はcomplete_work内で握って続行）
  v := public.complete_work(p_application_id, true);
  if not coalesce((v->>'ok')::boolean, false) then return v; end if;

  insert into public.reviews (application_id, reviewer_id, reviewee_id, direction,
                              want_again, entrust, on_time, as_described,
                              followed_instructions, completed_work,
                              public_comment, private_memo)
  values (p_application_id, v_farmer, v_worker, 'farmer_to_worker',
          p_want_again, p_entrust, p_on_time, p_as_described,
          p_followed_instructions, p_completed_work,
          nullif(trim(coalesce(p_public_comment,'')),''), nullif(trim(coalesce(p_private_memo,'')),''))
  on conflict (application_id, direction) do nothing;

  if p_want_again and p_favorite then
    insert into public.repeat_roster (farmer_id, worker_id, source_application_id, notify)
    values (v_farmer, v_worker, p_application_id, true)
    on conflict (farmer_id, worker_id) do nothing;
  end if;

  return json_build_object('ok', true, 'favorited', (p_want_again and p_favorite));
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_work(p_application_id uuid, p_attended boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_f uuid; v_w uuid; v_job int; v_status text; v_ref text; v_date_start date;
        v_auto boolean; v_att boolean; v_due timestamptz;
begin
  select farmer_id, worker_id, job_number, status, auto_completed, attended
    into v_f, v_w, v_job, v_status, v_auto, v_att
    from public.applications where id = p_application_id;
  if v_f is null then return json_build_object('ok', false, 'reason','not_found'); end if;
  if v_f <> auth.uid() then return json_build_object('ok', false, 'reason','not_yours'); end if;
  if v_status = 'completed' and not (coalesce(v_auto, false) and v_att is null) then
    return json_build_object('ok', true, 'already', true);
  end if;

  if v_status not in ('approved','meeting','interview','contracted','working','completed') then
    return json_build_object('ok', false, 'reason','この応募はまだ承認されていません。承認してから完了を記録してください');
  end if;
  v_due := public.app_work_due_at(p_application_id);
  if v_due is not null and now() < v_due then
    return json_build_object('ok', false, 'reason', 'この仕事はまだ終わっていません。最終作業日（' || to_char(v_due at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') || '）を過ぎてから完了を記録してください');
  end if;

  update public.applications
     set status = 'completed', attended = p_attended,
         work_completed_at = coalesce(work_completed_at, v_due, now())
   where id = p_application_id;
  v_ref := public.job_ref(v_job,'worker');

  if p_attended then
    begin
      perform public.send_user_email(v_w,
        '[chitose-bank] お疲れさまでした：求人 #' || v_job,
        '■ ' || v_ref || E'\n\n' ||
        '作業お疲れさまでした。評価は最終作業の終了から72時間以内に送信できます。公開は72時間後です。' || E'\n\n' ||
        'https://chitose-bank.com/#/profile/worker/approved');
    exception when others then null; end;
  else
    insert into public.notifications (farmer_id, type, message)
    values (v_w, 'no_show_recorded',
            '欠勤が記録されました：求人 #' || v_job || '　心当たりがない場合は72時間以内に異議申立ができます');
    begin
      perform public.send_user_email(v_w,
        '[chitose-bank] 欠勤が記録されました：求人 #' || v_job,
        '■ ' || v_ref || E'\n\n' ||
        '農家により欠勤が記録されました。' || E'\n' ||
        '心当たりがない場合は、72時間以内にアプリから異議申立ができます。' || E'\n' ||
        '（承認済みタブ → 該当の仕事 → 異議申立）' || E'\n\n' ||
        'https://chitose-bank.com');
    exception when others then null; end;
    perform public.notify_admins('no_show_recorded', '欠勤記録：求人 #' || v_job || '（異議窓72時間）');
  end if;
  return json_build_object('ok', true);
end; $function$;

CREATE OR REPLACE FUNCTION public.send_completion_confirmations()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  for r in
    select a.id, a.farmer_id, a.job_number, a.completion_remind_count,
           coalesce(j.date_end, j.date_start) as last_day
      from public.applications a join public.jobs j on j.job_number = a.job_number
     where a.status in ('approved','meeting','interview','contracted','working')
       and coalesce(j.date_end, j.date_start) < v_today
  loop
    if v_today - r.last_day >= 7 then
      update public.applications
         set status='completed', auto_completed=true,
             work_completed_at = coalesce(work_completed_at, public.app_work_due_at(r.id), now())
       where id = r.id;
    elsif r.completion_remind_count < 2 and public.app_review_accepting(r.id) then
      begin
        perform public.send_user_email(r.farmer_id,
          '[chitose-bank] 作業は終わりましたか？：あなたの求人 #' || r.job_number,
          '■ ' || public.job_ref(r.job_number,'farmer') || E'\n\n' ||
          '作業日が過ぎています。「完了して評価する」をお願いします' || E'\n' ||
          '（評価は最終作業の終了から72時間以内。公開は72時間後です）。' || E'\n\n' ||
          'https://chitose-bank.com/#/profile/employer/applicants');
      exception when others then null; end;
      update public.applications
         set completion_remind_count = completion_remind_count + 1 where id = r.id;
    end if;
  end loop;
end; $function$;

CREATE OR REPLACE FUNCTION public.reviews_public_badges(p_user_id uuid, p_direction text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entitled boolean;
  v_badges json; v_comments json; v_total int; v_waiting int;
begin
  if auth.uid() is null or p_user_id is null
     or p_direction not in ('farmer_to_worker','worker_to_farmer') then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;

  -- 閲覧資格は既存の信頼情報RPCと同一（範囲を勝手に広げない）
  if p_direction = 'farmer_to_worker' then
    v_entitled := (auth.uid() = p_user_id) or exists (
      select 1 from public.applications a
       where a.worker_id = p_user_id and a.farmer_id = auth.uid());
  else
    v_entitled := (auth.uid() = p_user_id) or exists (
      select 1 from public.applications a
       where a.farmer_id = p_user_id and a.worker_id = auth.uid())
      or exists (select 1 from public.jobs j where j.farmer_id = p_user_id and j.status = 'open');
  end if;
  if not v_entitled then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;

  with pub as (
    select r.*
      from public.reviews r
      join public.applications a on a.id = r.application_id
     where r.reviewee_id = p_user_id
       and r.direction = p_direction
       and public.app_review_published(r.application_id)
  )
  select
    json_build_object(
      'want_again',            count(*) filter (where want_again is true),
      'entrust',               count(*) filter (where entrust is true),
      'on_time',               count(*) filter (where on_time is true),
      'as_described',          count(*) filter (where as_described is true),
      'followed_instructions', count(*) filter (where followed_instructions is true),
      'completed_work',        count(*) filter (where completed_work is true),
      'safety_care',           count(*) filter (where safety_care is true),
      'instructions_clear',    count(*) filter (where instructions_clear is true),
      'paid_as_posted',        count(*) filter (where paid_as_posted is true),
      'trait_careful',         count(*) filter (where traits ? 'careful'),
      'trait_fast',            count(*) filter (where traits ? 'fast'),
      'trait_attentive',       count(*) filter (where traits ? 'attentive'),
      'trait_safe',            count(*) filter (where traits ? 'safe'),
      'trait_quality', count(*) filter (where traits ? 'quality'),
      'trait_crop_handling', count(*) filter (where traits ? 'crop_handling'),
      'trait_questions', count(*) filter (where traits ? 'questions'),
      'trait_progress', count(*) filter (where traits ? 'progress'),
      'trait_communication', count(*) filter (where traits ? 'communication'),
      'trait_punctual', count(*) filter (where traits ? 'punctual'),
      'trait_prepared', count(*) filter (where traits ? 'prepared'),
      'trait_schedule_contact', count(*) filter (where traits ? 'schedule_contact'),
      'trait_responsible', count(*) filter (where traits ? 'responsible'),
      'trait_tools', count(*) filter (where traits ? 'tools'),
      'trait_cleanup', count(*) filter (where traits ? 'cleanup'),
      'trait_hygiene', count(*) filter (where traits ? 'hygiene'),
      'trait_teamwork', count(*) filter (where traits ? 'teamwork'),
      'trait_considerate', count(*) filter (where traits ? 'considerate'),
      'trait_learning', count(*) filter (where traits ? 'learning'),
      'trait_adaptable', count(*) filter (where traits ? 'adaptable'),
      'trait_job_meeting_clear_good', count(*) filter (where traits ? 'job_meeting_clear_good'),
      'trait_job_tools_ready_good', count(*) filter (where traits ? 'job_tools_ready_good'),
      'trait_job_changes_shared_good', count(*) filter (where traits ? 'job_changes_shared_good'),
      'trait_job_demonstration_good', count(*) filter (where traits ? 'job_demonstration_good'),
      'trait_job_questions_welcome_good', count(*) filter (where traits ? 'job_questions_welcome_good'),
      'trait_job_respectful_good', count(*) filter (where traits ? 'job_respectful_good'),
      'trait_job_hazards_explained_good', count(*) filter (where traits ? 'job_hazards_explained_good'),
      'trait_job_heat_care_good', count(*) filter (where traits ? 'job_heat_care_good'),
      'trait_job_rest_water_good', count(*) filter (where traits ? 'job_rest_water_good'),
      'trait_job_hours_kept_good', count(*) filter (where traits ? 'job_hours_kept_good'),
      'trait_job_payment_clear_good', count(*) filter (where traits ? 'job_payment_clear_good'),
      'trait_job_workload_fit_good', count(*) filter (where traits ? 'job_workload_fit_good'),
      'trait_job_facilities_good', count(*) filter (where traits ? 'job_facilities_good'),
      'trait_job_team_atmosphere_good', count(*) filter (where traits ? 'job_team_atmosphere_good'),
      'trait_job_learning_support_good', count(*) filter (where traits ? 'job_learning_support_good')
    ),
    coalesce((
      select json_agg(json_build_object(
               'comment', c.public_comment,
               'date', to_char(c.created_at at time zone 'Asia/Tokyo','YYYY/MM/DD'))
             order by c.created_at desc)
        from pub c
       where c.comment_status is distinct from 'rejected'
         and nullif(btrim(coalesce(c.public_comment,'')),'') is not null
    ), '[]'::json),
    count(*)
  into v_badges, v_comments, v_total
  from pub;

  -- 公開待ち＝届いているが、まだゲートを越えていない評価の【件数だけ】
  select count(*) - coalesce(v_total,0)
    into v_waiting
    from public.reviews r
   where r.reviewee_id = p_user_id and r.direction = p_direction;

  return json_build_object('ok', true, 'badges', v_badges, 'comments', v_comments,
                           'total', coalesce(v_total,0), 'waiting', greatest(coalesce(v_waiting,0), 0));
end;
$function$;

CREATE OR REPLACE FUNCTION public.employer_trust_info(p_farmer_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ok boolean;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_matched int; v_partly int; v_differed int;
begin
  -- 停止・追放中の農家の信頼情報は本人以外に返さない（2026-08-16）
  if public.is_account_moderated(p_farmer_id)
     and (auth.uid() is null or auth.uid() <> p_farmer_id) then
    return json_build_object('ok', false);
  end if;
  v_ok := auth.uid() = p_farmer_id
    or exists (select 1 from public.applications a
                where a.farmer_id = p_farmer_id and a.worker_id = auth.uid())
    or exists (select 1 from public.jobs j
                where j.farmer_id = p_farmer_id and j.status = 'open');  -- 公開求人の農家は誰でも閲覧可
  if not v_ok then return json_build_object('ok', false); end if;

  -- 求人内容との一致（1契約1票・publishedのみ＝双方揃うか完了3日・第8条3）
  select count(*) filter (where r.match_level = 'matched'),
         count(*) filter (where r.match_level = 'partly'),
         count(*) filter (where r.match_level = 'differed')
    into v_matched, v_partly, v_differed
    from public.reviews r
    join public.applications a on a.id = r.application_id
   where r.reviewee_id = p_farmer_id
     and r.direction = 'worker_to_farmer'
     and r.match_level is not null
     and public.app_review_published(r.application_id);

  return (select json_build_object('ok', true,
    'member_since', to_char(u.created_at at time zone 'Asia/Tokyo','YYYY年MM月'),
    'id_checked', exists(select 1 from public.account_holders ah where ah.auth_id = p_farmer_id),
    'entity_type', (select ah.entity_type from public.account_holders ah where ah.auth_id = p_farmer_id),
    'completed_hires', (select count(*) from public.applications a
                          join public.jobs j on j.job_number = a.job_number
                         where a.farmer_id = p_farmer_id and a.status = 'completed'
                           and a.attended is true
                           and not (j.status = 'open'
                                    and (coalesce(j.date_end, j.date_start) is null
                                         or coalesce(j.date_end, j.date_start) >= v_today))),
    'open_jobs', (select count(*) from public.jobs j
                   where j.farmer_id = p_farmer_id and j.status = 'open'
                     and (coalesce(j.date_end, j.date_start) is null
                          or coalesce(j.date_end, j.date_start) >= v_today)),
    'ended_jobs', (select count(*) from public.jobs j
                    where j.farmer_id = p_farmer_id
                      and (j.status = 'closed'
                           or (j.status = 'open'
                               and coalesce(j.date_end, j.date_start) < v_today))),
    'active_applied', (select count(*) from public.applications a
                         join public.jobs j on j.job_number = a.job_number
                        where a.farmer_id = p_farmer_id
                          and a.status in ('applied','approved','working','completed')
                          and j.status = 'open'
                          and (coalesce(j.date_end, j.date_start) is null
                               or coalesce(j.date_end, j.date_start) >= v_today)),
    'active_approved', (select count(*) from public.applications a
                          join public.jobs j on j.job_number = a.job_number
                         where a.farmer_id = p_farmer_id
                           and a.status in ('approved','working','completed')
                           and j.status = 'open'
                           and (coalesce(j.date_end, j.date_start) is null
                                or coalesce(j.date_end, j.date_start) >= v_today)),
    'active_hired', (select count(*) from public.applications a
                       join public.jobs j on j.job_number = a.job_number
                      where a.farmer_id = p_farmer_id
                        and a.terms_confirmed_worker_at is not null
                        and a.terms_confirmed_farmer_at is not null
                        and j.status = 'open'
                        and (coalesce(j.date_end, j.date_start) is null
                             or coalesce(j.date_end, j.date_start) >= v_today)),
    'want_again_workers', (select count(*) from public.reviews r
                            where r.reviewee_id = p_farmer_id
                              and r.direction = 'worker_to_farmer' and r.want_again = true
                              and public.app_review_published(r.application_id)),
    'match_total', (v_matched + v_partly + v_differed),
    'match_matched', v_matched,
    'match_partly', v_partly,
    'match_differed', v_differed,
    'avg_response_hours', (select round(avg(extract(epoch from (decided_at - created_at))/3600)::numeric, 1)
                            from public.applications a
                           where a.farmer_id = p_farmer_id and a.decided_at is not null),
    'avg_approval_hours', (select round(avg(extract(epoch from (decided_at - created_at))/3600)::numeric, 1)
                            from public.applications a
                           where a.farmer_id = p_farmer_id and a.decided_at is not null and a.status <> 'rejected'))
    from auth.users u where u.id = p_farmer_id);
end; $function$;

CREATE OR REPLACE FUNCTION public.worker_trust_info(p_worker_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_joined timestamptz; v_verified timestamptz;
  v_reviewed int; v_want int; v_completed int; v_hours int;
begin
  if auth.uid() is null or (auth.uid() <> p_worker_id and not exists (
    select 1 from public.applications a
    where a.worker_id = p_worker_id and a.farmer_id = auth.uid()
  )) then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;

  select created_at into v_joined from auth.users where id = p_worker_id;
  select created_at into v_verified from public.account_holders where auth_id = p_worker_id;

  select count(*), count(*) filter (where want_again)
    into v_reviewed, v_want
    from public.reviews
   where reviewee_id = p_worker_id
     and direction = 'farmer_to_worker'
     and want_again is not null
     and public.app_review_published(application_id);

  select count(*) into v_completed
    from public.applications
   where worker_id = p_worker_id and status = 'completed' and attended is distinct from false;

  -- hours = app_accrued_minutes: per-day scheduled minutes x finished work days (2026-08-21).
  -- working accrues day by day / completed is frozen at its completion date. same rule as worker_work_record
  select (coalesce(sum(public.app_accrued_minutes(a.id)), 0) / 60)::int
    into v_hours
    from public.applications a
    join public.jobs j on j.job_number = a.job_number
   where a.worker_id = p_worker_id and a.status in ('working','completed') and a.attended is distinct from false;

  return json_build_object('ok', true, 'joined_at', v_joined, 'verified_at', v_verified,
    'reviewed_count', coalesce(v_reviewed, 0), 'want_again_count', coalesce(v_want, 0),
    'completed_count', coalesce(v_completed, 0), 'total_hours', coalesce(v_hours, 0));
end;
$function$;

CREATE OR REPLACE FUNCTION public.my_worker_trust_stats()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_joined timestamptz; v_verified timestamptz;
  v_reviewed int; v_want int; v_completed int; v_hours int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  select created_at into v_joined from auth.users where id = auth.uid();
  select created_at into v_verified from public.account_holders where auth_id = auth.uid();

  select count(*), count(*) filter (where want_again)
    into v_reviewed, v_want
    from public.reviews
   where reviewee_id = auth.uid()
     and direction = 'farmer_to_worker'
     and want_again is not null
     and public.app_review_published(application_id);

  select count(*) into v_completed
    from public.applications
   where worker_id = auth.uid() and status = 'completed' and attended is distinct from false;

  select (coalesce(sum(public.app_accrued_minutes(a.id)), 0) / 60)::int
    into v_hours
    from public.applications a
    join public.jobs j on j.job_number = a.job_number
   where a.worker_id = auth.uid() and a.status in ('working','completed') and a.attended is distinct from false;

  return json_build_object(
    'ok', true, 'joined_at', v_joined, 'verified_at', v_verified,
    'reviewed_count', coalesce(v_reviewed, 0), 'want_again_count', coalesce(v_want, 0),
    'completed_count', coalesce(v_completed, 0), 'total_hours', coalesce(v_hours, 0));
end;
$function$;

CREATE OR REPLACE FUNCTION public.worker_trust_info_bulk(p_worker_ids uuid[])
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with req as (
    select distinct t.id
      from unnest(coalesce(p_worker_ids, '{}'::uuid[])) as t(id)
     where t.id is not null
  ),
  allowed as (
    select r.id as worker_id
      from req r
     where auth.uid() is not null
       and (r.id = auth.uid()
            or exists (select 1 from public.applications a
                        where a.worker_id = r.id and a.farmer_id = auth.uid()))
  ),
  rv as (
    select r.reviewee_id as worker_id,
           count(*)::int as reviewed_count,
           (count(*) filter (where r.want_again))::int as want_again_count
      from public.reviews r
      join allowed al on al.worker_id = r.reviewee_id
     where r.direction = 'farmer_to_worker' and r.want_again is not null
       and public.app_review_published(r.application_id)
     group by r.reviewee_id
  ),
  done as (
    select a.worker_id,
           (count(*) filter (where a.status = 'completed'))::int as completed_count,
           (coalesce(sum(public.app_accrued_minutes(a.id)), 0) / 60)::int as total_hours
      from public.applications a
      join allowed al on al.worker_id = a.worker_id
     where a.status in ('working','completed') and a.attended is distinct from false
     group by a.worker_id
  )
  select coalesce(json_object_agg(al.worker_id::text, json_build_object(
           'ok', true,
           'joined_at',   (select u.created_at from auth.users u where u.id = al.worker_id),
           'verified_at', (select h.created_at from public.account_holders h where h.auth_id = al.worker_id),
           'reviewed_count',   coalesce(rv.reviewed_count, 0),
           'want_again_count', coalesce(rv.want_again_count, 0),
           'completed_count',  coalesce(dn.completed_count, 0),
           'total_hours',      coalesce(dn.total_hours, 0)
         )), '{}'::json)
    from allowed al
    left join rv on rv.worker_id = al.worker_id
    left join done dn on dn.worker_id = al.worker_id;
$function$;

CREATE OR REPLACE FUNCTION public.worker_want_again_count(p_worker_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;
  if auth.uid() <> p_worker_id and not exists (
    select 1 from public.applications a
    where a.worker_id = p_worker_id and a.farmer_id = auth.uid()
  ) then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;

  select count(*) into v_count from public.reviews
    where reviewee_id = p_worker_id and direction = 'farmer_to_worker' and want_again = true
      and public.app_review_published(application_id);

  return json_build_object('ok', true, 'want_again_count', v_count);
end;
$function$;

CREATE OR REPLACE FUNCTION public.my_todo_items()
 RETURNS TABLE(my_role text, stage text, job_number integer, application_id uuid, crop text, task text, partner_name text, partner_avatar text, partner_id uuid, date_start date, date_end date, work_time text, agreed_dates jsonb, sort_key date)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with u as (select auth.uid() as uid, (now() at time zone 'Asia/Tokyo')::date as today),
  rev as (
    select 'farmer'::text my_role, 'revision'::text stage, j.job_number, null::uuid application_id,
           j.crop, j.task, null::text partner_name, null::text partner_avatar, null::uuid partner_id,
           j.date_start, j.date_end, j.work_time, null::jsonb agreed_dates,
           u.today sort_key
    from jobs j, u
    where j.farmer_id = u.uid and j.status = 'draft' and j.revision_requested_at is not null
      and coalesce(j.date_end, j.date_start) >= u.today
  ),
  fq as (
    select 'farmer'::text my_role, 'question'::text stage, q.job_number, q.id application_id,
           j.crop, j.task,
           public.resolve_actor_name(q.asker_id) partner_name,
           (select wp.avatar_url from worker_profiles wp where wp.auth_id = q.asker_id) partner_avatar,
           q.asker_id partner_id,
           j.date_start, j.date_end, j.work_time, null::jsonb agreed_dates,
           u.today sort_key
    from job_questions q join jobs j on j.job_number = q.job_number, u
    where j.farmer_id = u.uid and coalesce(q.answer, '') = '' and q.hidden = false
  ),
  fa as (
    select a.id, a.status, a.job_number, a.agreed_dates, a.started_at,
           a.insurance_prepared_at, a.work_completed_at, a.terms_confirmed_farmer_at,
           a.worker_id partner_id,
           j.crop, j.task, j.date_start, j.date_end, j.work_time,
           public.resolve_actor_name(a.worker_id) partner_name,
           (select wp.avatar_url from worker_profiles wp where wp.auth_id = a.worker_id) partner_avatar,
           exists(select 1 from messages m where m.application_id = a.id and m.sender_id <> u.uid and m.read_at is null) unread,
           (select max(d) from public.app_work_dates(a.id) d) last_wd,
           exists(select 1 from public.app_work_dates(a.id) d where d = u.today) is_wd,
           u.uid, u.today
    from applications a join jobs j on j.job_number = a.job_number, u
    where a.farmer_id = u.uid
  ),
  fstage as (
    select 'farmer'::text my_role,
      case
        when status = 'applied' then 'approve'
        -- 全体の評価は最終作業日に達してから（中日は下の day_report が受け持つ）
        when status in ('approved','meeting','interview','contracted','working') and started_at is not null and status <> 'completed'
             and public.app_review_accepting(id) then 'complete'
        when status in ('approved','meeting','interview','contracted','working') and insurance_prepared_at is null
             then 'insurance'
        when status = 'completed' and public.app_review_accepting(id)
             and not exists(select 1 from reviews r where r.application_id = fa.id and r.reviewer_id = uid) then 'complete'
        else null
      end stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      case when started_at is not null then today
           else coalesce(date_start, today) end sort_key
    from fa
  ),
  fhire as (
    select 'farmer'::text my_role, 'hire'::text stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      coalesce(date_start, today) sort_key
    from fa
    where status in ('approved','meeting','interview') and terms_confirmed_farmer_at is null
  ),
  -- その日の記録（農家）：作業中で、今日が実働日で、まだ最終日ではない日だけ。
  -- CASE ではなく独立した枝にしてある＝保険の報告など他の用件と同時に並べられる
  fday as (
    select 'farmer'::text my_role, 'day_report'::text stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      today sort_key
    from fa
    where status = 'working' and last_wd is not null and today < last_wd and is_wd
  ),
  wa as (
    select a.id, a.status, a.job_number, a.agreed_dates,
           a.terms_confirmed_worker_at, a.attended, a.work_completed_at,
           a.farmer_id partner_id,
           j.crop, j.task, j.date_start, j.date_end, j.work_time,
           public.resolve_actor_name(a.farmer_id) partner_name,
           (select ep.avatar_url from employer_profiles ep where ep.auth_id = a.farmer_id) partner_avatar,
           exists(select 1 from messages m where m.application_id = a.id and m.sender_id <> u.uid and m.read_at is null) unread,
           ((u.today between j.date_start and coalesce(j.date_end, j.date_start))
            or (a.agreed_dates is not null and jsonb_typeof(a.agreed_dates) = 'array'
                and exists(select 1 from jsonb_array_elements_text(a.agreed_dates) d where d::date = u.today))) is_work_day,
           (select max(d) from public.app_work_dates(a.id) d) last_wd,
           exists(select 1 from public.app_work_dates(a.id) d where d = u.today) is_wd,
           u.uid, u.today
    from applications a join jobs j on j.job_number = a.job_number, u
    where a.worker_id = u.uid
  ),
  wstage as (
    select 'worker'::text my_role,
      case
        -- 全体の評価は最終作業日に達してから（中日は下の w_day_report が受け持つ）
        when status = 'working' and attended is distinct from false
             and public.app_review_accepting(id)
             and not exists(select 1 from reviews r where r.application_id = wa.id and r.reviewer_id = uid) then 'w_review'
        when status = 'completed' and attended is distinct from false
             and public.app_review_accepting(id)
             and not exists(select 1 from reviews r where r.application_id = wa.id and r.reviewer_id = uid) then 'w_review'
        else null
      end stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      case when is_work_day then today else coalesce(date_start, today) end sort_key
    from wa
  ),
  -- その日の記録（働き手）：作業中で、今日が実働日で、まだ最終日ではない日だけ
  wday as (
    select 'worker'::text my_role, 'w_day_report'::text stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      today sort_key
    from wa
    where status = 'working' and last_wd is not null and today < last_wd and is_wd
  )
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from rev
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from fq
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from fstage where stage is not null
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from fhire
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from fday
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from wstage where stage is not null
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from wday
$function$;

CREATE OR REPLACE FUNCTION public.my_nav_badges()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with u as (select public.my_unread_message_counts() as j)
  select json_build_object(
    'chat_threads', (
      (select count(*) from json_object_keys((select j from u) -> 'by_application'))
      + case when coalesce(((select j from u) ->> 'dm')::int, 0) > 0 then 1 else 0 end
    ),
    'calendar_today', (
      select count(*) from public.applications a
      join public.jobs j on j.job_number = a.job_number
      where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
        and a.status in ('contracted','working')
        and (now() at time zone 'Asia/Tokyo')::date between j.date_start and coalesce(j.date_end, j.date_start)
    ),
    'todo', (select count(*) from public.my_todo_items()),
    'applicants_pending', (
      select count(*) from public.applications a
      where a.farmer_id = auth.uid() and a.status = 'applied'
    ),
    'review_due', (
      select count(*) from public.applications a
      where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
        and a.status = 'completed'
        and public.app_review_accepting(a.id)
        and not exists (select 1 from public.reviews r
                         where r.application_id = a.id and r.reviewer_id = auth.uid())
    ),
    'job_revision', (
      select count(*) from public.jobs j
      where j.farmer_id = auth.uid() and j.status = 'draft' and j.revision_requested_at is not null
        and coalesce(j.date_end, j.date_start) >= (now() at time zone 'Asia/Tokyo')::date
    )
  )
  from u;
$function$;

-- 受付通知から内容や肯定・否定を推測させない。双方提出による早期開示も撤去。
create or replace function public.trg_review_celebration()
returns trigger language plpgsql security definer set search_path = ''
as $$ declare v_deadline text;
begin
  v_deadline := to_char((public.app_review_opened_at(new.application_id)+interval '72 hours') at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI');
  insert into public.notifications(farmer_id,type,message)
    values(new.reviewee_id,'review_received','仕事の評価が届いています。内容は受付終了後に表示されます。');
  begin
    perform public.send_user_email(new.reviewee_id,'[chitose-bank] 仕事の評価を受け付けました',
      '仕事の評価が届いています。評価の受付終了・公開は '||v_deadline||'（日本時間）です。'||E'\n'||
      'お互いの提出状況にかかわらず、この日時より前には内容は表示されません。期限後は評価を入力できません。'||E'\n'||
      'https://chitose-bank.com/#/profile');
  exception when others then null; end;
  return new;
end; $$;
revoke all on function public.trg_review_celebration() from public,anon,authenticated;
