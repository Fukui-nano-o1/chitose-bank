-- 契約記録（terms_snapshot）の管理者閲覧RPC：凍結された合意内容＋当事者＋確認時刻
create or replace function public.admin_list_contracts()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'application_id', a.id,
      'job_number', a.job_number,
      'farmer_name', public.resolve_actor_name(a.farmer_id),
      'worker_name', public.resolve_actor_name(a.worker_id),
      'applied_at', to_char(a.created_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
      'approved_at', to_char(a.decided_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
      'worker_confirmed', to_char(a.terms_confirmed_worker_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
      'farmer_confirmed', to_char(a.terms_confirmed_farmer_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
      'status', a.status,
      'started_at', to_char(a.started_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
      'completed_at', to_char(a.work_completed_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
      'snapshot', a.terms_snapshot
    ) order by a.created_at desc)
    from public.applications a
    where a.terms_snapshot is not null
  ), '[]'::json);
end; $$;
grant execute on function public.admin_list_contracts() to authenticated;