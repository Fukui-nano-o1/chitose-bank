-- 仕事の評価：両方向を良い点20・悪い点20に拡充。既存5列とタグの保存キーを維持する。
-- 否定のタグは公開集計に含めない。入力は当事者・完了済みの既存RLSを引き続き通す。
create or replace function public.review_traits_valid(p_direction text, p_traits jsonb)
returns boolean language plpgsql immutable security invoker set search_path = ''
as $function$
declare v_allowed text[];
begin
  if p_traits is null then return true; end if;
  if jsonb_typeof(p_traits) <> 'array' then return false; end if;
  if jsonb_array_length(p_traits) > 40 then return false; end if;
  if p_direction = 'farmer_to_worker' then
    v_allowed := array['careful',
      'work_issue',
      'fast',
      'pace_issue',
      'quality',
      'quality_issue',
      'crop_handling',
      'crop_handling_issue',
      'attentive',
      'instruction_issue',
      'questions',
      'questions_issue',
      'progress',
      'progress_issue',
      'communication',
      'comm_issue',
      'punctual',
      'time_issue',
      'prepared',
      'preparation_issue',
      'schedule_contact',
      'schedule_contact_issue',
      'responsible',
      'responsibility_issue',
      'safe',
      'safety_issue',
      'tools',
      'tools_issue',
      'cleanup',
      'cleanup_issue',
      'hygiene',
      'hygiene_issue',
      'teamwork',
      'teamwork_issue',
      'considerate',
      'respect_issue',
      'learning',
      'learning_issue',
      'adaptable',
      'adaptation_issue'];
  elsif p_direction = 'worker_to_farmer' then
    v_allowed := array['job_meeting_clear_good',
      'job_meeting_clear_improve',
      'job_tools_ready_good',
      'job_tools_ready_improve',
      'job_changes_shared_good',
      'job_changes_shared_improve',
      'job_demonstration_good',
      'job_demonstration_improve',
      'job_questions_welcome_good',
      'job_questions_welcome_improve',
      'job_respectful_good',
      'job_respectful_improve',
      'job_hazards_explained_good',
      'job_hazards_explained_improve',
      'job_heat_care_good',
      'job_heat_care_improve',
      'job_rest_water_good',
      'job_rest_water_improve',
      'job_hours_kept_good',
      'job_hours_kept_improve',
      'job_payment_clear_good',
      'job_payment_clear_improve',
      'job_workload_fit_good',
      'job_workload_fit_improve',
      'job_facilities_good',
      'job_facilities_improve',
      'job_team_atmosphere_good',
      'job_team_atmosphere_improve',
      'job_learning_support_good',
      'job_learning_support_improve'];
  else return false;
  end if;
  return not exists (
    select 1 from jsonb_array_elements(p_traits) as t(value)
    where jsonb_typeof(value) <> 'string' or not ((value #>> '{}') = any(v_allowed))
  ) and jsonb_array_length(p_traits) = (
    select count(distinct value) from jsonb_array_elements(p_traits) as t(value)
  );
end;
$function$;
revoke all on function public.review_traits_valid(text,jsonb) from public, anon;
grant execute on function public.review_traits_valid(text,jsonb) to authenticated, service_role;

alter table public.reviews add constraint reviews_traits_catalog_check
  check (public.review_traits_valid(direction,traits)) not valid;
alter table public.reviews validate constraint reviews_traits_catalog_check;
comment on column public.reviews.traits is '仕事の評価の追加選択肢。方向別の許可キー配列。肯定のみ公開集計、否定は評価者と運営のみ。既存キーを維持。';

-- 無効な項目は完了処理・通知・お気に入り登録より前に拒否する。
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
    from public.applications where id = p_application_id;
  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if auth.uid() is null or v_farmer is distinct from auth.uid() then return json_build_object('ok', false, 'reason', 'not_yours'); end if;

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
revoke all on function public.submit_farmer_final_review(uuid,text,text,jsonb,boolean) from public, anon;
grant execute on function public.submit_farmer_final_review(uuid,text,text,jsonb,boolean) to authenticated;

-- 公開対象者・3日待機・コメント非表示・公開待ち件数は既存定義を維持。
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
       and (
         (a.work_completed_at is not null and a.work_completed_at <= now() - interval '3 days')
         or exists (select 1 from public.reviews r2
                     where r2.application_id = r.application_id
                       and r2.reviewer_id = r.reviewee_id)
       )
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
revoke all on function public.reviews_public_badges(uuid,text) from public, anon;
grant execute on function public.reviews_public_badges(uuid,text) to authenticated;
