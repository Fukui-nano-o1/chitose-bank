-- 採用時に凍結した契約条件スナップショットの一覧（管理者専用・2026-07-21）
-- 両者確認済み（terms_snapshotあり）の応募を、当事者名・凍結時刻つきで返す。争いの証跡確認用
create or replace function public.admin_list_contracts()
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'application_id', a.id,
      'job_number', a.job_number,
      'status', a.status,
      'worker_id', a.worker_id,
      'farmer_id', a.farmer_id,
      'worker_name', wp.nickname,
      'farmer_name', ep.nickname,
      'worker_confirmed_at', to_char(a.terms_confirmed_worker_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
      'farmer_confirmed_at', to_char(a.terms_confirmed_farmer_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
      'snapshot_at', to_char((a.terms_snapshot->>'snapshot_at')::timestamptz at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
      'snapshot', a.terms_snapshot
    ) order by (a.terms_snapshot->>'snapshot_at')::timestamptz desc)
    from public.applications a
    left join public.worker_profiles wp on wp.auth_id = a.worker_id
    left join public.employer_profiles ep on ep.auth_id = a.farmer_id
    where a.terms_snapshot is not null
  ), '[]'::json);
end; $$;