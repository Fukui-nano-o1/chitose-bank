-- 応募・掲載の封鎖＋管理一覧に状態を追加（2026-07-19）

-- 応募：停止/追放は応募不可
CREATE OR REPLACE FUNCTION public.apply_to_job(p_job_number integer)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_worker_id uuid; v_farmer_id uuid; v_status text; v_app_id uuid;
  v_nickname text; v_qa_count int := 0; v_under_review boolean; v_revision boolean;
begin
  v_worker_id := auth.uid();
  if v_worker_id is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  if public.is_account_moderated(v_worker_id) then
    return json_build_object('ok', false, 'reason', 'account_suspended');
  end if;

  select farmer_id, status into v_farmer_id, v_status from public.jobs where job_number = p_job_number;
  if v_farmer_id is null then return json_build_object('ok', false, 'reason', 'job_not_found'); end if;
  if v_status <> 'open' then return json_build_object('ok', false, 'reason', 'job_not_open'); end if;
  if v_farmer_id = v_worker_id then return json_build_object('ok', false, 'reason', 'own_job'); end if;

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

  insert into public.applications (job_number, worker_id, farmer_id, status)
  values (p_job_number, v_worker_id, v_farmer_id, 'applied')
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

-- 掲載（審査提出・公開）：停止/追放された農家の求人はpending/openにできない（プロフィール審査ゲートと同居）
create or replace function public.block_publish_when_profile_under_review()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.status in ('pending','open')
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and not exists (select 1 from public.app_admins a where a.auth_id = new.farmer_id)
  then
    if public.is_account_moderated(new.farmer_id) then
      raise exception 'ACCOUNT_MODERATED: このアカウントは停止中のため掲載できません';
    end if;
    if new.status = 'pending'
       and exists (select 1 from public.employer_profiles ep
                    where ep.auth_id = new.farmer_id
                      and ((ep.texts_pending is not null and ep.texts_pending <> '{}'::jsonb)
                           or ep.texts_revision_requested_at is not null))
    then
      raise exception 'PROFILE_UNDER_REVIEW: プロフィール審査中は掲載できません（下書き保存は可能です）';
    end if;
  end if;
  return new;
end; $function$;

-- 管理一覧に停止/追放の状態を追加
CREATE OR REPLACE FUNCTION public.admin_list_accounts()
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  return (
    select json_agg(json_build_object(
      'auth_id', u.id, 'email', u.email, 'email_masked', public.mask_email(u.email),
      'nickname', wp.nickname, 'avatar_url', wp.avatar_url,
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
      'reported', (select count(*) from public.job_reports jr join public.jobs j2 on j2.job_number = jr.job_number where j2.farmer_id = u.id)
    ) order by
      (coalesce(m.state,'active') <> 'active') desc,
      (wp.pr_pending is not null or wp.pr_qa_pending is not null) desc,
      u.last_sign_in_at desc nulls last)
    from auth.users u
    left join public.worker_profiles wp on wp.auth_id = u.id
    left join public.account_holders ah on ah.auth_id = u.id
    left join public.account_moderation m on m.auth_id = u.id
  );
end; $function$;