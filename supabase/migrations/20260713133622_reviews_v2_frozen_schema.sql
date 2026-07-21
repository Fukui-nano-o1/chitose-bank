-- 評価スキーマv2（2026-07-13深夜凍結）
-- 農家→働き手：また呼びたい(want_again)／安心して任せられた(entrust)
-- 働き手→農家：また働きたい(want_again)／説明のとおり(as_described)／安全に配慮(safety_care)
-- ＋公開コメント(任意)＋非公開メモ。3日相互非公開→片方単独公開。
-- 時間・出欠・総時間等は評価ではなく実績台帳（打刻由来・別途実装）が担う。
alter table public.reviews
  add column if not exists entrust boolean,        -- 安心して任せられた（農家→働き手）
  add column if not exists safety_care boolean,    -- 安全に配慮されていた（働き手→農家）
  add column if not exists public_comment text,    -- 公開コメント（任意・直近3-5件表示の素材）
  add column if not exists published_at timestamptz;  -- 公開日時（3日ルールの制御用）

comment on table public.reviews is
  '評価v2：人間が答えるのは機械に測れない軸のみ。実績（遅刻/欠席/総時間/件数）は打刻由来の実績台帳が担当。自由記述を集計して軸を進化させる方針（2026-07-13）';

-- 1件目（#1036・農家→働き手）に entrust を追記（聴取メモの内容と整合：任せられなかった）
update public.reviews
   set entrust = false
 where direction = 'farmer_to_worker'
   and application_id = (select id from public.applications where job_number = 1036);