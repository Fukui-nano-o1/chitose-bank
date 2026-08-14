-- 管理アカウント一覧に役割情報を追加（2026-08-07たきと指示「雇い手と働き手で切り替え」）。
-- 追加キー：has_worker / has_employer（プロフィール行の有無＝骨格⑥「役割はプロフィールが決める」）、
-- employer_nickname / employer_avatar_url（雇い手面の表示名・アイコン）。
-- 既存キー・並び・権限は不変（あいうえお順の並び替えと絞り込みはフロント側で行う）。
create or replace function public.admin_list_accounts()
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
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
      'reported', (select count(*) from public.job_reports jr join public.jobs j2 on j2.job_number = jr.job_number where j2.farmer_id = u.id)
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
end; $function$;
