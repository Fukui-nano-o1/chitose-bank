-- チャットを求人(応募)ごとに分離したのに合わせ、下部ナビの未読チャットバッジも応募単位で数える（2026-07-23）。
-- 以前は「相手（partner）ごとの未読スレッド数」だったが、チャット一覧・チャット本体が求人ごとに分かれたため、
-- 未読スレッド＝未読メッセージのある応募(application_id)の数、に合わせる。運営DM未読があれば +1 は据え置き。
create or replace function public.my_nav_badges()
 returns json
 language sql
 security definer
 set search_path to 'public'
 stable
as $function$
  select json_build_object(
    'chat_threads', (
      select count(distinct m.application_id)
        from public.messages m join public.applications a on a.id = m.application_id
       where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
         and a.status in ('applied','approved','meeting','interview','contracted','working','completed','rejected')
         and m.sender_id <> auth.uid() and m.read_at is null
    ) + (case when exists (
        select 1 from public.admin_messages am
        where am.user_id = auth.uid() and am.from_admin and am.read_at is null
      ) then 1 else 0 end),
    'calendar_today', (
      select count(*) from public.applications a join public.jobs j on j.job_number = a.job_number
      where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
        and a.terms_snapshot is not null
        and j.date_start is not null
        and (now() at time zone 'Asia/Tokyo')::date >= j.date_start
        and (now() at time zone 'Asia/Tokyo')::date <= coalesce(j.date_end, j.date_start)
    ),
    'review_due', (
      select count(*) from public.applications a
      where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
        and a.status = 'completed'
        and a.work_completed_at is not null
        and a.work_completed_at >= now() - interval '3 days'
        and not exists (select 1 from public.reviews r where r.application_id = a.id and r.reviewer_id = auth.uid())
    ),
    'job_revision', (
      select count(*) from public.jobs j
      where j.farmer_id = auth.uid() and j.status = 'draft' and j.revision_requested_at is not null
    )
  );
$function$;
