-- 管理画面の仕事後の評価。運営の閲覧専用。公開集計・本人限定RLSは変更しない。
-- 本人だけのprivate_memo、自由記述、住所・連絡先は返さない。
create or replace function public.admin_work_reviews(p_direction text default 'worker_to_farmer', p_offset integer default 0)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare v_items jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.app_admins where auth_id = auth.uid()) then
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
$$;
revoke all on function public.admin_work_reviews(text, integer) from public, anon;
grant execute on function public.admin_work_reviews(text, integer) to authenticated;
create index if not exists reviews_direction_created_id_idx on public.reviews (direction, created_at desc, id desc);
