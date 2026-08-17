-- 下部ナビ「🤝応募者」バッジの数え方を、応募者アイコンのジャンプと同じ単一ソースに揃える（2026-07-26たきと報告）。
-- 従来：status='applied' の件数だけ＝「応募中」しか数えず、質問を送る/開始確認/完了記録などの未対応が漏れていた
-- （バッジ1なのに跳ねるアイコンが2、の原因）。
-- 新：my_todo_items の farmer 用件のうち応募に紐づくもの（hireは除外＝アイコン側と同条件）を数える。
-- あわせて my_todo_items() の二重実行を避けるためCTE化（todoと共用）。
-- （DBには2026-07-26にMCP直接適用済み。本ファイルは正本の写経）
create or replace function public.my_nav_badges()
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with t as (select * from public.my_todo_items())
  select json_build_object(
    'chat_threads', (
      select count(distinct m.application_id)
        from public.messages m join public.applications a on a.id = m.application_id
       where (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
         and a.status in ('applied','approved','meeting','interview','contracted','working','rejected')
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
        and case
          when a.agreed_dates is not null and jsonb_typeof(a.agreed_dates) = 'array' and jsonb_array_length(a.agreed_dates) > 0
            then exists (select 1 from jsonb_array_elements_text(a.agreed_dates) d where d::date = (now() at time zone 'Asia/Tokyo')::date)
          else (now() at time zone 'Asia/Tokyo')::date >= j.date_start
               and (now() at time zone 'Asia/Tokyo')::date <= coalesce(j.date_end, j.date_start)
        end
    ),
    'todo', (select count(*) from t),
    -- 応募者バッジ＝未対応の応募（跳ねるアイコンと同数）。hireは承認後ずっと出続ける段ので除外
    'applicants_pending', (
      select count(distinct application_id) from t
       where my_role = 'farmer' and application_id is not null and stage <> 'hire'
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
