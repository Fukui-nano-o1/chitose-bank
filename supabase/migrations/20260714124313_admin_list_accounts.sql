-- 新アカウントタブの台帳RPC：auth.users全員＋判断材料＋要対応フラグ（管理者のみ）
create or replace function public.admin_list_accounts()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  return (
    select json_agg(json_build_object(
      'auth_id', u.id,
      'email', u.email,
      'nickname', wp.nickname,
      'avatar_url', wp.avatar_url,
      'confirmed', u.email_confirmed_at is not null,
      'never_signed_in', u.last_sign_in_at is null,
      'last_sign_in_jst', to_char(u.last_sign_in_at at time zone 'Asia/Tokyo','MM/DD HH24:MI'),
      'created_jst', to_char(u.created_at at time zone 'Asia/Tokyo','YYYY/MM/DD'),
      'has_id_check', ah.auth_id is not null,
      'id_check_month', to_char(ah.created_at at time zone 'Asia/Tokyo','YYYY年MM月'),
      'pending_text', (wp.pr_pending is not null or wp.pr_qa_pending is not null),
      'pending_since', to_char(wp.pr_submitted_at at time zone 'Asia/Tokyo','MM/DD HH24:MI'),
      'pr_pending', wp.pr_pending,
      'pr_qa_pending', wp.pr_qa_pending,
      'apps_applied', (select count(*) from public.applications a where a.worker_id = u.id),
      'apps_completed', (select count(*) from public.applications a
                          where a.worker_id = u.id and a.status = 'completed'),
      'jobs_posted', (select count(*) from public.jobs j where j.farmer_id = u.id),
      'want_again', (select count(*) from public.reviews r
                      where r.reviewee_id = u.id and r.direction = 'farmer_to_worker'
                        and r.want_again = true),
      'reported', (select count(*) from public.job_reports jr
                    join public.jobs j2 on j2.job_number = jr.job_number
                   where j2.farmer_id = u.id)
    ) order by
      (wp.pr_pending is not null or wp.pr_qa_pending is not null) desc,  -- 要対応が上
      u.last_sign_in_at desc nulls last)
    from auth.users u
    left join public.worker_profiles wp on wp.auth_id = u.id
    left join public.account_holders ah on ah.auth_id = u.id
  );
end; $$;
grant execute on function public.admin_list_accounts() to authenticated;