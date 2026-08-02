-- 応募者ページの読み込みを1往復に（2026-08-02・たきと指示「応募者ページの復元も遅い」）。
-- 従来は getSession→①my_todo_items＋applications→②reviews＋worker_profiles＋worker_trust_info_bulk
-- ＋interview_question_sends の直列2波・計6本で、全部返るまでスケルトンのままだった。
-- 本関数は SECURITY INVOKER＝呼び出し者の権限のまま実行し、各テーブルのRLSがそのまま適用される
-- （見える範囲は従来のクライアント直叩きと機械的に同一。権限判定の写経を持たない）。
-- 内部で呼ぶ my_todo_items / worker_trust_info_bulk は既存の SECURITY DEFINER 関数＝
-- それぞれのゲート判定がそのまま生きる（まとめたから緩む、を起こさない）。
create or replace function public.my_farm_applicants()
returns json
language sql
security invoker
set search_path to 'public'
as $$
  with apps as (
    select * from applications where farmer_id = auth.uid()
  ),
  wids as (
    select distinct worker_id from apps where worker_id is not null
  )
  select json_build_object(
    'apps', coalesce((select json_agg(to_jsonb(a) order by a.created_at desc) from apps a), '[]'::json),
    'todo', coalesce((select json_agg(json_build_object('application_id', t.application_id, 'stage', t.stage))
                        from my_todo_items() t
                       where t.my_role = 'farmer' and t.application_id is not null), '[]'::json),
    'reviewed_ids', coalesce((select json_agg(r.application_id) from reviews r
                               where r.reviewer_id = auth.uid()
                                 and r.application_id in (select id from apps where status = 'completed')), '[]'::json),
    'qsent_ids', coalesce((select json_agg(distinct s.application_id) from interview_question_sends s
                            where s.application_id in (select id from apps)), '[]'::json),
    'profiles', coalesce((select json_agg(to_jsonb(wp)) from worker_profiles wp
                           where wp.auth_id in (select worker_id from wids)), '[]'::json),
    'trust', coalesce((select worker_trust_info_bulk(array(select worker_id from wids))), '{}'::json)
  );
$$;
revoke all on function public.my_farm_applicants() from public, anon;
grant execute on function public.my_farm_applicants() to authenticated;
