-- 応募者のアイコン・名前that全部「？」になる件の修理（2026-08-16たきと報告「アイコンが全て？になる」）
--
-- 【原因】my_farm_applicants は SECURITY INVOKER（呼んだ人の権限で読む）のまま
--   worker_profiles を直接 select していた。2026-08-07に「wp farmer select via application」
--   ポリシーを落とした（未承認の自己紹介that農家のクライアントに届く穴の修理）ため、
--   一般の農家（app_admins に無い人）では profiles that0件になり、名前・アイコンthat全て空＝「？」に落ちていた。
--   運営アカウントは「wp admin select」で読めていたため気づきにくかった。
--   実測（修理前）：管理者=応募14/プロフィール4 ／ 一般農家=応募6/プロフィール0。
--   実測（修理後）：一般農家=応募6/プロフィール4/名前あり4・未承認混入0（管理者側は不変）。
--
-- 【修理】profiles を worker_profile_for_farmer(worker_id)（SECURITY DEFINER・当事者ゲート・
--   承認済みの安全な列だけ・審査中は {under_review:true}）経由にする。
--   ＝2026-08-07の穴（pr_pending/pr_qa_pending の露出）を再び開けずに、名前とアイコンだけ戻す。
--   to_jsonb(wp) の全列返しは廃止。
-- 【注】審査中の働き手は本文that返らないため auth_id thaが無い。フロントは profiles[wp.auth_id] で
--   引くので、ここで auth_id を必ず付ける（付けないと undefined をキーに積んでしまう）。
-- ★教訓：SECURITY INVOKER の関数は、参照先テーブルのRLSを変えた時に一緒に見直すこと。
--   DEFINERの窓口を作ってRLSを閉じたら、その表を直接読んでいるINVOKER関数thaが無いか必ず洗う。

create or replace function public.my_farm_applicants()
returns json
language sql
set search_path to 'public'
as $function$
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
    'profiles', coalesce((select json_agg(jsonb_build_object('auth_id', w.worker_id) || f.j)
                            from wids w
                            cross join lateral (select worker_profile_for_farmer(w.worker_id)::jsonb as j) f
                           where f.j is not null), '[]'::json),
    'trust', coalesce((select worker_trust_info_bulk(array(select worker_id from wids))), '{}'::json)
  );
$function$;

revoke all on function public.my_farm_applicants() from public, anon;
grant execute on function public.my_farm_applicants() to authenticated;
