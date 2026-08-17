-- job_ref(p_job integer, p_viewer text) は通知・メールの「求人の参照名」を作る内部ヘルパー。
-- 23本の内部トリガー/RPC（trg_notify_*・send_*・confirm_*・approve_application 等）が呼ぶが、
-- フロントは直接呼ばない（grep空）。にもかかわらず作成時のPUBLIC自動EXECUTE付与で anon/authenticated から
-- 直接叩けた＝求人番号が1000からの連番ので推測容易なため、任意のログインユーザーが連番を舐めるだけで、
-- 【まだ公開していない draft/pending 求人の農園名＋作物＋作業】を引けた
-- （2026-08-07 実機一周でauthの穴として発見・無関係ユーザーが draft #1029 の農園名「せんと」取得を実証）。
-- jobs_public は open/closed しか出さないのに、この関数は jobs を直読みので未公開の下書きの中身が漏れていた。
-- 内部呼び出しはSECURITY DEFINERの所有者権限で走るためEXECUTE grantに依存しない＝revoke後も23本は無傷
-- （apply_to_job→通知経路が通り続けることを実測）。
-- app_work_dates（2026-08-07同日）と同型＝「当事者判定を本体に持たないSECURITY DEFINERヘルパーの直叩き露出」。

revoke all on function public.job_ref(integer, text) from public, anon, authenticated;
