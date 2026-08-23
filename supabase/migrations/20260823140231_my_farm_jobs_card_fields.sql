-- 2026-08-23：あなたの求人ページのカードを「その他の求人」と同じ設計（JobCard）にするための列追加。
-- 追加するのは自分の求人の列だけ＝可視範囲は不変（SECURITY INVOKER・RLSそのまま）。
-- hired_count は jobs_public と同じ数え方（双方の確認時刻that揃った応募）＝サイト内で満員の定義を1つに保つ。
-- ★opened_at を固定列から落とさないこと（一時非公開の判定に必須・2026-08-02の注意書き）。
create or replace function public.my_farm_jobs()
 returns json
 language sql
 set search_path to 'public'
as $function$
  with j as (
    select job_number, crop, task, date_label, prefecture, city, pay_type, hourly_wage, daily_wage,
           photos, status, date_start, date_end, work_time, opened_at, holidays,
           headcount, beginner_ok, experienced_preferred, instant_approve_repeat,
           (select count(*) from applications a
              where a.job_number = jobs.job_number
                and a.terms_confirmed_worker_at is not null
                and a.terms_confirmed_farmer_at is not null) as hired_count
    from jobs where farmer_id = auth.uid()
  )
  select json_build_object(
    'jobs', coalesce((select json_agg(to_jsonb(x) order by x.job_number desc) from j x), '[]'::json),
    'q_unanswered', coalesce((select json_object_agg(q.job_number::text, q.cnt) from (
        select job_number, count(*)::int cnt from job_questions
        where job_number in (select job_number from j) and answer is null and hidden = false
        group by job_number) q), '{}'::json)
  );
$function$;
