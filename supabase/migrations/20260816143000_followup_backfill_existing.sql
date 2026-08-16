-- 段階督促の導入時の地ならし（2026-08-16）
--
-- 導入した瞬間に、既にある未回答の応募へ過去分の督促（最悪は「72時間未回答・最終通知」）が
-- 飛ぶのを防ぐ。既に過ぎた段は「送らなかった記録」（sent=false）として先に埋め、
-- これから到達する段からだけ送る。
-- 記録は残す＝いつ導入され、どの段を送らなかったのかが後から分かる（行動記録の憲法）。
-- 導入後に受け付けた応募は、12時間から順に通常どおり送られる。

insert into public.application_followup_notices (application_id, stage_hours, sent)
select a.id, s.stage, false
  from public.applications a
  cross join unnest(array[12,24,36,48,60,72]) as s(stage)
 where a.status = 'applied'
   and extract(epoch from (now() - a.created_at)) / 3600.0 >= s.stage
on conflict do nothing;
