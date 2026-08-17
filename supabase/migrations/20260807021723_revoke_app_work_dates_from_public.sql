-- app_work_dates は confirm_terms の内部専用ヘルパー（二重予約判定の実働日集合・2026-08-06）。
-- フロントは直接呼ばない（lib/hire.js が同じ規則を自前で持つ）のに、作成時のPUBLICへの自動EXECUTE付与で
-- anon/authenticated から直接叩けた＝任意の応募uuidを知る者が、その応募の稼働日を引ける穴があった
-- （2026-08-07 プラポリ後の実機一周で発見・anonロールで実応募の稼働日7件取得を実証）。
-- SECURITY DEFINER の内部呼び出し（confirm_terms→app_work_dates）はEXECUTE権限に依存しないので、
-- from public で全面revokeしても機能は無傷（2026-08-06「revokeはfrom publicが要る」の教訓）。
-- audit③bのパターン（send_/notify_/expire_/summarize_/purge_/process_）に名前が合わず擦り抜けた型ので、
-- ③bの網に app_ 系の当事者スコープ・ヘルパーも今後含める。

revoke all on function public.app_work_dates(uuid) from public, anon, authenticated;
