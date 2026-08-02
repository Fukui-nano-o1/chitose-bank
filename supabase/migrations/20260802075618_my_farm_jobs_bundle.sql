-- お仕事タブ求人面（作成中/公開中/期限切れ）の読み込みを1往復に（2026-08-02・たきと指示「求人ページも遅い」）。
-- 従来は getSession→自分のjobs取得→job_questions未回答集計 の直列で、スケルトン解除が最後だった。
-- my_farm_applicants と同じ設計：SECURITY INVOKER＝呼び出し者の権限のまま実行し、
-- jobs / job_questions のRLSがそのまま適用される（見える範囲は従来のクライアント直叩きと同一）。
-- 列は従来クライアントの固定SELECTと同一（opened_at を落とすと一時非公開判定が壊れる・2026-07-16注意書き踏襲）
create or replace function public.my_farm_jobs()
returns json
language sql
security invoker
set search_path to 'public'
as $$
  with j as (
    select job_number, crop, task, date_label, prefecture, city, pay_type, hourly_wage, daily_wage,
           photos, status, date_start, date_end, work_time, opened_at
    from jobs where farmer_id = auth.uid()
  )
  select json_build_object(
    'jobs', coalesce((select json_agg(to_jsonb(x) order by x.job_number desc) from j x), '[]'::json),
    'q_unanswered', coalesce((select json_object_agg(q.job_number::text, q.cnt) from (
        select job_number, count(*)::int cnt from job_questions
        where job_number in (select job_number from j) and answer is null and hidden = false
        group by job_number) q), '{}'::json)
  );
$$;
revoke all on function public.my_farm_jobs() from public, anon;
grant execute on function public.my_farm_jobs() to authenticated;
