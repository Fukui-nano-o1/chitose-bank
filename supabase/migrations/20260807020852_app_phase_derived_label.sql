-- app_phase：応募の段階ラベルのDB側唯一のソース（2026-08-07・たきと採用「ラベルは貼らずに導け」）
--
-- 【思想】行動記録の憲法（2026-07-25）どおり、段階は列に保存せず記録から導出する。
-- フロントの appPhaseKey（src/lib/utils.js）の鏡＝同じ式。★片方を変えたら必ず両方変えること。
-- 段階：applied(応募中)→interview(面接中)→contracted(採用)→working(作業中)→completed(完了)
-- ＋終端 rejected(見送り)／expired(失効)。
-- statusだけでは面接中/採用を区別できない（採用はterms確認時刻で管理・
-- contracted/meeting/interviewは書き込まれない表示用値）ため、応募行から導出する。
--
-- 【使い方】public.app_phase(a) （applications の行を渡す）。immutable so
-- ビュー・RPC・トリガー・cron・点検のどこからでも使える。
-- 状態条件を書くときは status リストの手書きでなくこれを使う（条件の書き写しズレを構造的に消す）。
-- ※ラベルを農家への表示・並び替え・優先提示に使うのは推薦・選別の禁止（2026-07-16）に
--   抵触しうる＝処理の内部語彙に留める。スコア化・ランク化は不可。

create or replace function public.app_phase(a public.applications)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when a.status in ('applied','rejected','expired','completed','working') then a.status
    when a.terms_confirmed_worker_at is not null and a.terms_confirmed_farmer_at is not null then 'contracted'
    else 'interview'
  end
$$;

comment on function public.app_phase(public.applications) is
  '応募の段階ラベル（導出・保存しない）。フロント appPhaseKey の鏡＝両方同時に変えること（2026-08-07）';
