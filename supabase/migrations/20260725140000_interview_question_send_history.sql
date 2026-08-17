-- 面接の質問集の送信履歴（2026-07-25たきと指示）：
-- ①送信履歴テーブル interview_question_sends を新設（いつ・どの応募に・どの質問集を送ったか）
-- ②send_interview_questions が送信時に履歴も記録
-- ③やること「面接の質問」（my_todo_items finterview）の計上を、
--   本文パターン照合（【面接の質問】%・テンプレ文言変更で壊れる）→履歴の有無に置換
-- ④既存の送信済みメッセージから履歴をバックフィル（用件の再出現防止・適用時6件）
-- 権限：書き込みはRPC（security definer）経由のみ。クライアントはSELECTのみ（RLSで本人行に限定）

create table public.interview_question_sends (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  farmer_id uuid not null,
  set_id uuid references public.farmer_question_sets(id) on delete set null, -- 質問集を後で消しても履歴は残す
  set_title text,          -- 送信時点のタイトルのスナップショット（セット改名・削除に耐える）
  sent_at timestamptz not null default now()
);
create index interview_question_sends_app_idx on public.interview_question_sends(application_id);
alter table public.interview_question_sends enable row level security;
create policy "iqs farmer select" on public.interview_question_sends
  for select to authenticated using (farmer_id = auth.uid());
revoke all on public.interview_question_sends from anon, authenticated;
grant select on public.interview_question_sends to authenticated;

-- ④ バックフィル：農家が送った【面接の質問】メッセージを履歴化（set_idは不明のでNULL）
insert into public.interview_question_sends (application_id, farmer_id, set_title, sent_at)
select m.application_id, m.sender_id, null, m.created_at
from public.messages m
join public.applications a on a.id = m.application_id and a.farmer_id = m.sender_id
where m.body like '【面接の質問】%';

-- ② 送信RPC：チャット投函に加えて履歴を記録
create or replace function public.send_interview_questions(p_application_id uuid, p_set_id uuid)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_farmer uuid; v_status text; v_title text; v_qs jsonb; v_body text; v_i int := 0; v_q text;
begin
  select farmer_id, status into v_farmer, v_status
    from public.applications where id = p_application_id;
  if v_farmer is null then return json_build_object('ok',false,'reason','not_found'); end if;
  if v_farmer <> auth.uid() then return json_build_object('ok',false,'reason','not_yours'); end if;
  if v_status not in ('applied','approved','meeting','interview','contracted') then
    return json_build_object('ok',false,'reason','bad_status');
  end if;

  select title, questions into v_title, v_qs
    from public.farmer_question_sets where id = p_set_id and farmer_id = auth.uid();
  if v_qs is null or jsonb_array_length(v_qs) = 0 then
    return json_build_object('ok',false,'reason','empty_set');
  end if;
  if jsonb_array_length(v_qs) > 5 then
    return json_build_object('ok',false,'reason','too_many','message','質問は5問までです');
  end if;

  v_body := '【面接の質問】' || coalesce(nullif(v_title,''),'') || E'\n' ||
            'お手すきの時に、このチャットでお答えください。';
  for v_q in select jsonb_array_elements_text(v_qs) loop
    v_i := v_i + 1;
    v_body := v_body || E'\n' || v_i || '. ' || v_q;
  end loop;

  insert into public.messages (application_id, sender_id, body)
  values (p_application_id, auth.uid(), v_body);
  -- 送信履歴（2026-07-25）：やること「面接の質問」はこの履歴の有無で計上する
  insert into public.interview_question_sends (application_id, farmer_id, set_id, set_title)
  values (p_application_id, auth.uid(), p_set_id, v_title);
  return json_build_object('ok', true);
end; $function$;

-- ③ my_todo_items：finterview の判定を履歴の有無に置換（他の段は不変）
create or replace function public.my_todo_items()
 returns table(my_role text, stage text, job_number integer, application_id uuid, crop text, task text, partner_name text, partner_avatar text, partner_id uuid, date_start date, date_end date, work_time text, agreed_dates jsonb, sort_key date)
 language sql
 security definer
 set search_path to 'public'
as $function$
  with u as (select auth.uid() as uid, (now() at time zone 'Asia/Tokyo')::date as today),
  rev as (
    select 'farmer'::text my_role, 'revision'::text stage, j.job_number, null::uuid application_id,
           j.crop, j.task, null::text partner_name, null::text partner_avatar, null::uuid partner_id,
           j.date_start, j.date_end, j.work_time, null::jsonb agreed_dates,
           u.today sort_key
    from jobs j, u
    where j.farmer_id = u.uid and j.status = 'draft' and j.revision_requested_at is not null
  ),
  fa as (
    select a.id, a.status, a.job_number, a.agreed_dates, a.started_at, a.farmer_confirmed_start_at,
           a.insurance_prepared_at, a.work_completed_at, a.terms_confirmed_farmer_at,
           a.worker_id partner_id,
           j.crop, j.task, j.date_start, j.date_end, j.work_time,
           public.resolve_actor_name(a.worker_id) partner_name,
           (select wp.avatar_url from worker_profiles wp where wp.auth_id = a.worker_id) partner_avatar,
           exists(select 1 from messages m where m.application_id = a.id and m.sender_id <> u.uid and m.read_at is null) unread,
           u.uid, u.today
    from applications a join jobs j on j.job_number = a.job_number, u
    where a.farmer_id = u.uid
  ),
  fstage as (
    select 'farmer'::text my_role,
      case
        when status = 'applied' then 'approve'
        when status in ('approved','meeting','interview','contracted','working') and started_at is not null and farmer_confirmed_start_at is null then 'confirm_start'
        when status in ('approved','meeting','interview','contracted','working') and farmer_confirmed_start_at is not null and status <> 'completed' then 'complete'
        when status in ('approved','meeting','interview','contracted','working') and insurance_prepared_at is null
             and not exists (select 1 from employer_profiles ep,
                                   jsonb_array_elements_text(ep.insurance_items) it
                              where ep.auth_id = uid
                                and jsonb_typeof(ep.insurance_items) = 'array'
                                and it <> 'considering') then 'insurance'
        when status = 'completed' and work_completed_at is not null and work_completed_at >= now() - interval '3 days'
             and not exists(select 1 from reviews r where r.application_id = id and r.reviewer_id = uid) then 'review'
        when unread then 'chat'
        else null
      end stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      case when started_at is not null or farmer_confirmed_start_at is not null then today
           else coalesce(date_start, today) end sort_key
    from fa
  ),
  finterview as ( -- 面接の質問を送る：送信履歴（interview_question_sends）が無い応募だけ計上（2026-07-25置換）
    select 'farmer'::text my_role, 'interview'::text stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      coalesce(date_start, today) sort_key
    from fa
    where status in ('approved','meeting','interview') and terms_confirmed_farmer_at is null
      and not exists (select 1 from interview_question_sends s
                       where s.application_id = fa.id)
  ),
  fhire as ( -- 採用する（チャットの採用ボタンの移設・独立段）
    select 'farmer'::text my_role, 'hire'::text stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      coalesce(date_start, today) sort_key
    from fa
    where status in ('approved','meeting','interview') and terms_confirmed_farmer_at is null
  ),
  wa as (
    select a.id, a.status, a.job_number, a.agreed_dates, a.started_at, a.worker_confirmed_end_at,
           a.terms_confirmed_worker_at, a.attended, a.work_completed_at,
           a.farmer_id partner_id,
           j.crop, j.task, j.date_start, j.date_end, j.work_time,
           public.resolve_actor_name(a.farmer_id) partner_name,
           (select ep.avatar_url from employer_profiles ep where ep.auth_id = a.farmer_id) partner_avatar,
           exists(select 1 from messages m where m.application_id = a.id and m.sender_id <> u.uid and m.read_at is null) unread,
           ((u.today between j.date_start and coalesce(j.date_end, j.date_start))
            or (a.agreed_dates is not null and jsonb_typeof(a.agreed_dates) = 'array'
                and exists(select 1 from jsonb_array_elements_text(a.agreed_dates) d where d::date = u.today))) is_work_day,
           u.uid, u.today
    from applications a join jobs j on j.job_number = a.job_number, u
    where a.worker_id = u.uid
  ),
  wstage as (
    select 'worker'::text my_role,
      case
        when status = 'applied' then 'w_waiting'
        when status in ('approved','meeting','interview','contracted','working') and terms_confirmed_worker_at is null then 'w_confirm'
        when status in ('approved','meeting','interview','contracted','working') and is_work_day and started_at is null then 'w_start'
        when status = 'completed' and attended is distinct from false and worker_confirmed_end_at is null
             and work_completed_at is not null and work_completed_at >= now() - interval '3 days' then 'w_review'
        when unread then 'chat'
        else null
      end stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      case when is_work_day then today else coalesce(date_start, today) end sort_key
    from wa
  ),
  winterview as ( -- 面接の回答（働き手・独立段）：最後の【面接の質問】以降に自分の返信が無い
    select 'worker'::text my_role, 'w_interview'::text stage,
      job_number, id application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates,
      coalesce(date_start, today) sort_key
    from wa
    where status in ('approved','meeting','interview')
      and exists (select 1 from messages q
                   where q.application_id = wa.id and q.sender_id = wa.partner_id
                     and q.body like '【面接の質問】%'
                     and not exists (select 1 from messages r
                                      where r.application_id = wa.id and r.sender_id = wa.uid
                                        and r.created_at > q.created_at))
  )
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from rev
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from fstage where stage is not null
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from finterview
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from fhire
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from wstage where stage is not null
  union all
  select my_role, stage, job_number, application_id, crop, task, partner_name, partner_avatar, partner_id, date_start, date_end, work_time, agreed_dates, sort_key from winterview
$function$;
