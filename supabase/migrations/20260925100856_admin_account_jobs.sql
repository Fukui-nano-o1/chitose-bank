-- 管理者専用：アカウント詳細ページの「求人」タブの材料を1往復で返す
-- posted = そのアカウントが掲載主(farmer_id)の求人（全ステータス・新しい順・最大100件）
-- applied = そのアカウントが働き手(worker_id)として出した応募（求人の姿を左結合・新しい順・最大100件）
-- applications には管理者のSELECTポリシーが無いため SECURITY DEFINER の窓口が必要（2026-09-25調査）
create or replace function public.admin_account_jobs(p_auth_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_posted jsonb;
  v_applied jsonb;
begin
  if auth.uid() is null or not exists (select 1 from app_admins where auth_id = auth.uid()) then
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
$$;

revoke all on function public.admin_account_jobs(uuid) from public;
revoke all on function public.admin_account_jobs(uuid) from anon;
grant execute on function public.admin_account_jobs(uuid) to authenticated, service_role;
