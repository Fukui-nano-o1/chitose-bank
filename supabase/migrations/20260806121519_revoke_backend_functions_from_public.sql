-- バックエンド専用の裏方関数を、クライアントから閉じる
-- （2026-08-06・実機一周後の点検 audit.sql ③b that検出）
--
-- 【何that問題か】送信・cron・内部の関数that、Postgresのデフォルト（作成時にPUBLICへEXECUTE付与）の
-- ままクライアントに開いていた。特に send_user_email(uuid,text,text,text) は、既知のUUIDへ
-- 任意の件名・本文でメールを送れる＝なりすまし・スパムの踏み台になりうる（適用前にanonから
-- 実行権限thaあることを実測）。他も expire_stale_applications 等のcronを外から手動発火できた。
--
-- 【★重要：FROM PUBLIC で閉じる】anon/authenticated は PUBLIC のメンバーで、関数は作成時に
-- PUBLIC へ EXECUTE that自動付与される。so `revoke ... from anon, authenticated` では
-- PUBLIC 経由の権限that残り効かない（当日1度 from anon,authenticated で当ててノーオペを実測→
-- 履歴を取り消し、この from public 版に置き換えた）。PUBLIC から revoke するのtha正しい。
--
-- 【安全性】revokeしても壊れない（適用後に実測）：
--   ・cron（pg_cron）は postgres ロールで動く＝PUBLIC権限と無関係（expire_stale_applications 実行OK）
--   ・内部呼び出し（confirm_insurance 等that perform public.send_user_email）は
--     SECURITY DEFINER 関数の中so、関数所有者の権限で実行される＝EXECUTE権限に依らない（ok=true）
--   ・anonからの直叩きは権限エラーで拒否されることを実測
--   ・フロントからの直接呼び出しは無い（send_interview_questions のみthaフロント呼び出し＝対象外so残す）
-- 2026-08-03に resolve_actor_name / unread_count_for を同じ理由でrevokeしたのと同じ観点。

revoke execute on function public.send_user_email(uuid, text, text, text) from public;
revoke execute on function public.send_admin_email(text, text, text) from public;
revoke execute on function public.notify_admins(text, text) from public;
revoke execute on function public.expire_stale_applications() from public;
revoke execute on function public.summarize_sessions() from public;
revoke execute on function public.send_completion_confirmations() from public;
revoke execute on function public.send_daily_auth_digest() from public;
revoke execute on function public.send_insurance_reminders() from public;
revoke execute on function public.send_job_start_reminders() from public;
revoke execute on function public.send_review_reminder() from public;
-- send_interview_questions は残す（フロントthauthenticatedで呼ぶ・内部にfarmer本人ゲートあり）。
