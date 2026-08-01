-- 仕事中専用ページ（#/admin/working・管理者専用・2026-08-01）用の読み取りRPC。
-- 「今まさに作業が進んでいるマッチ（status=working）」と「採用済み・未開始（まもなく開始）」を
-- 当事者名・求人情報・打刻/保険/確認の時刻つきで返す。運営の見守り（売り物＝安心）のための一覧。
-- 書き込みは一切しない読み取り専用RPC。admin_list_contracts と同じ security definer + app_admins ゲート。
-- 名前は当事者名（wp/ep.nickname）を返す＝管理者専用RPCなのでデータ憲法のクライアント全件配信禁止には当たらない
--（admin_list_contracts が既に当事者名を返しているのと同じ扱い）。
create or replace function public.admin_working_jobs()
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_working json;
  v_upcoming json;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;

  -- 仕事中（status=working）。開始が古い順＝長く進んでいる/完了漏れが上に来る
  select coalesce(json_agg(row order by started_at_raw asc nulls last), '[]'::json) into v_working
  from (
    select
      json_build_object(
        'application_id', a.id,
        'job_number', a.job_number,
        'worker_id', a.worker_id,
        'farmer_id', a.farmer_id,
        'worker_name', wp.nickname,
        'farmer_name', ep.nickname,
        'crop', j.crop,
        'task', j.task,
        'prefecture', j.prefecture,
        'city', j.city,
        'date_label', j.date_label,
        'date_start', j.date_start,
        'date_end', j.date_end,
        'agreed_dates', a.agreed_dates,
        'auto_started', a.auto_started,
        'attended', a.attended,
        'started_at', to_char(a.started_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'farmer_confirmed_start_at', to_char(a.farmer_confirmed_start_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'work_completed_at', to_char(a.work_completed_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'worker_confirmed_end_at', to_char(a.worker_confirmed_end_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'insurance_prepared_at', to_char(a.insurance_prepared_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI')
      ) as row,
      a.started_at as started_at_raw
    from public.applications a
    left join public.jobs j on j.job_number = a.job_number
    left join public.worker_profiles wp on wp.auth_id = a.worker_id
    left join public.employer_profiles ep on ep.auth_id = a.farmer_id
    where a.status = 'working'
  ) t;

  -- まもなく開始（採用済み＝双方が契約確認済み・未開始）。開始予定日が近い順
  select coalesce(json_agg(row order by ord_date asc nulls last), '[]'::json) into v_upcoming
  from (
    select
      json_build_object(
        'application_id', a.id,
        'job_number', a.job_number,
        'worker_id', a.worker_id,
        'farmer_id', a.farmer_id,
        'worker_name', wp.nickname,
        'farmer_name', ep.nickname,
        'crop', j.crop,
        'task', j.task,
        'prefecture', j.prefecture,
        'city', j.city,
        'date_label', j.date_label,
        'date_start', j.date_start,
        'date_end', j.date_end,
        'agreed_dates', a.agreed_dates,
        'insurance_prepared_at', to_char(a.insurance_prepared_at at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI'),
        'hired_at', to_char(greatest(a.terms_confirmed_worker_at, a.terms_confirmed_farmer_at) at time zone 'Asia/Tokyo','YYYY/MM/DD HH24:MI')
      ) as row,
      j.date_start as ord_date
    from public.applications a
    left join public.jobs j on j.job_number = a.job_number
    left join public.worker_profiles wp on wp.auth_id = a.worker_id
    left join public.employer_profiles ep on ep.auth_id = a.farmer_id
    where a.status = 'approved'
      and a.terms_confirmed_worker_at is not null
      and a.terms_confirmed_farmer_at is not null
      and a.started_at is null
  ) t;

  return json_build_object('ok', true, 'working', v_working, 'upcoming', v_upcoming);
end; $$;

revoke all on function public.admin_working_jobs() from anon, authenticated;
grant execute on function public.admin_working_jobs() to authenticated;
