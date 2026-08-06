-- anon一括revoke（2026-08-06 実機一周②⑤）：ログイン後専用のRPCを訪問者(anon)から機構的に閉じる。
-- 従来は各関数の内部ゲート（auth.uid()チェック）だけが壁＝フェイルオープンのバグ1つで漏れる構造だった
-- （前例2回：worker_trust_info・worker_want_again_count）。EXECUTE権限の壁を重ねて二重にする。
-- ★残す10本（訪問者が実際に使う・意図して開けているもの）：
--   signup_open / job_exists / job_employer_profile / job_employer_trust_info /
--   employer_public_jobs / employer_public_job_counts / employer_trust_info（2026-07-29仕様）/
--   is_account_moderated（RLSポリシー内で評価されるためanonのSELECTを壊さない）/
--   is_measured（トリガー経由の訪問者計測を壊さない・低リスク）/ push_vapid_public（公開鍵）
-- ★教訓（2026-08-06追補）：Supabaseのdefault privilegesは関数作成時にanonへ明示付与するので、
--   revokeは「from public」と「from anon」の両方が必要。authenticatedへは明示grantで残す。
-- オーバーロード対応のためoid列挙で全シグネチャに適用。
-- 検証済み：適用後のanon実行可RPC＝上記10本ちょうど／authenticatedの喪失0本／点検①〜⑤OK。

do $$
declare rec record;
begin
  for rec in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname = any(array[
         'admin_hide_question','admin_list_accounts','admin_list_contracts','admin_moderate_account',
         'admin_preview_job','admin_working_jobs','answer_job_question','apply_to_job','approve_application',
         'approve_profile_text','ask_job_question','auto_publish_profile_texts','cancel_application',
         'complete_work','confirm_end','confirm_insurance','confirm_start','copy_job',
         'create_pending_application','decide_time_correction','get_my_calendar_jobs','is_worker_profile_ready',
         'job_meeting_place','job_ref','my_todo_items','promote_my_pending_applications','punch_start',
         'request_job_revision','request_profile_revision','request_time_correction','request_worker_pr_revision',
         'rls_auto_enable','save_push_subscription','send_interview_questions','set_agreed_dates',
         'worker_trust_info','am_i_account_allowed'])
  loop
    execute format('revoke all on function %s from public', rec.sig);
    execute format('revoke execute on function %s from anon', rec.sig);
    execute format('grant execute on function %s to authenticated, service_role', rec.sig);
  end loop;
end $$;
