-- 労働時間集計の日またぎバグを修理（2026-08-06 バグ狩りで発見）。
-- 症状：worker_trust_info / worker_trust_info_bulk / my_worker_trust_stats の total_hours が、
--   インラインで end::time - start::time を計算しており、日またぎ勤務（例 22:00〜06:00）で
--   負の時間（-16）を加算していた。実測：22:00〜06:00 の完了実績1件で total_hours=-16。
--   時給の日またぎ求人は最賃チェック（時給額のみ）を通過ので掲載可能＝実在しうる入力。
-- 不整合：worker_work_record は job_scheduled_minutes ヘルパー（日またぎ→null 安全）を使い、
--   同じ求人を unknown_time_count に計上して total_minutes には足さない。3関数だけ生計算で食い違っていた。
-- 対処：3関数の時間集計を job_scheduled_minutes ヘルパーに統一（単一ソース化）。
--   ヘルパーは end<=start を null に倒すので、日またぎ・不正な範囲は自動的に合計から除外される
--   （worker_work_record と同じ扱い＝「憶測で時間を作らない」）。正常な日中勤務の値は不変。
-- 検証済み（ロールバック付き実弾）：日中8h+2h+日またぎ8h の3件で total_hours=10（旧は10-16=-6相当）、
--   worker_work_record と一致（total_minutes=600・unknown_time_count=1）、bulkも10。
-- 影響範囲：本番の日またぎ完了実績は現在0件＝潜在バグ・既存データの汚染なし。

create or replace function public.worker_trust_info(p_worker_id uuid)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_joined timestamptz; v_verified timestamptz;
  v_reviewed int; v_want int; v_completed int; v_hours int;
begin
  if auth.uid() is null or (auth.uid() <> p_worker_id and not exists (
    select 1 from public.applications a
    where a.worker_id = p_worker_id and a.farmer_id = auth.uid()
  )) then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;

  select created_at into v_joined from auth.users where id = p_worker_id;
  select created_at into v_verified from public.account_holders where auth_id = p_worker_id;

  select count(*), count(*) filter (where want_again)
    into v_reviewed, v_want
    from public.reviews
   where reviewee_id = p_worker_id
     and direction = 'farmer_to_worker'
     and want_again is not null;

  select count(*) into v_completed
    from public.applications
   where worker_id = p_worker_id and status = 'completed' and attended is distinct from false;

  -- 日またぎ安全：job_scheduled_minutes（end<=start→null）を合計し時間に。worker_work_recordと同じ数え方
  select (coalesce(sum(public.job_scheduled_minutes(j.work_time)), 0) / 60)::int
    into v_hours
    from public.applications a
    join public.jobs j on j.job_number = a.job_number
   where a.worker_id = p_worker_id and a.status = 'completed' and a.attended is distinct from false;

  return json_build_object('ok', true, 'joined_at', v_joined, 'verified_at', v_verified,
    'reviewed_count', coalesce(v_reviewed, 0), 'want_again_count', coalesce(v_want, 0),
    'completed_count', coalesce(v_completed, 0), 'total_hours', coalesce(v_hours, 0));
end;
$function$;

create or replace function public.my_worker_trust_stats()
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_joined timestamptz; v_verified timestamptz;
  v_reviewed int; v_want int; v_completed int; v_hours int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  select created_at into v_joined from auth.users where id = auth.uid();
  select created_at into v_verified from public.account_holders where auth_id = auth.uid();

  select count(*), count(*) filter (where want_again)
    into v_reviewed, v_want
    from public.reviews
   where reviewee_id = auth.uid()
     and direction = 'farmer_to_worker'
     and want_again is not null;

  select count(*) into v_completed
    from public.applications
   where worker_id = auth.uid() and status = 'completed' and attended is distinct from false;

  select (coalesce(sum(public.job_scheduled_minutes(j.work_time)), 0) / 60)::int
    into v_hours
    from public.applications a
    join public.jobs j on j.job_number = a.job_number
   where a.worker_id = auth.uid() and a.status = 'completed' and a.attended is distinct from false;

  return json_build_object(
    'ok', true, 'joined_at', v_joined, 'verified_at', v_verified,
    'reviewed_count', coalesce(v_reviewed, 0), 'want_again_count', coalesce(v_want, 0),
    'completed_count', coalesce(v_completed, 0), 'total_hours', coalesce(v_hours, 0));
end;
$function$;

create or replace function public.worker_trust_info_bulk(p_worker_ids uuid[])
 returns json language sql stable security definer set search_path to 'public'
as $function$
  with req as (
    select distinct t.id
      from unnest(coalesce(p_worker_ids, '{}'::uuid[])) as t(id)
     where t.id is not null
  ),
  allowed as (
    select r.id as worker_id
      from req r
     where auth.uid() is not null
       and (r.id = auth.uid()
            or exists (select 1 from public.applications a
                        where a.worker_id = r.id and a.farmer_id = auth.uid()))
  ),
  rv as (
    select r.reviewee_id as worker_id,
           count(*)::int as reviewed_count,
           (count(*) filter (where r.want_again))::int as want_again_count
      from public.reviews r
      join allowed al on al.worker_id = r.reviewee_id
     where r.direction = 'farmer_to_worker' and r.want_again is not null
     group by r.reviewee_id
  ),
  done as (
    select a.worker_id,
           count(*)::int as completed_count,
           (coalesce(sum(public.job_scheduled_minutes(j.work_time)), 0) / 60)::int as total_hours
      from public.applications a
      join allowed al on al.worker_id = a.worker_id
      left join public.jobs j on j.job_number = a.job_number
     where a.status = 'completed' and a.attended is distinct from false
     group by a.worker_id
  )
  select coalesce(json_object_agg(al.worker_id::text, json_build_object(
           'ok', true,
           'joined_at',   (select u.created_at from auth.users u where u.id = al.worker_id),
           'verified_at', (select h.created_at from public.account_holders h where h.auth_id = al.worker_id),
           'reviewed_count',   coalesce(rv.reviewed_count, 0),
           'want_again_count', coalesce(rv.want_again_count, 0),
           'completed_count',  coalesce(dn.completed_count, 0),
           'total_hours',      coalesce(dn.total_hours, 0)
         )), '{}'::json)
    from allowed al
    left join rv on rv.worker_id = al.worker_id
    left join done dn on dn.worker_id = al.worker_id;
$function$;
