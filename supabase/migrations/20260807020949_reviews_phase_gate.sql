-- 評価に状態の壁を追加（2026-08-07・最短遷移の実機一周の発見の修理）
--
-- 【何が問題だったか】reviews の壁は当事者性（RLS＋party_consistency）だけで、応募の状態を
-- 見ていなかった＝応募中（承認・完了なし）のまま評価2件が書けた（機構の裸の最短3遷移）。
-- reviews は worker_trust_info の評価件数・また呼びたい件数の材料so、働いた事実なしに
-- 信頼の数字を作れる穴だった（実弾で確認済み・実害ゼロ＝発見時 total_reviews=0…実レビューは以後増分のみ）。
--
-- 【壁の条件＝正規経路を1件も弾かない形（方向別・app_phase による初適用）】
--  farmer_to_worker：completed のみ。正規経路 submit_farmer_review は complete_work を先に
--    実行してから INSERT するso常に completed（実測済み）。
--  worker_to_farmer：working または completed。働き手の評価UI（WorkerApplications）は
--    started_at がある時だけ出る＝開始済み（=working）。農家の完了記録が先なら completed。
--    ※打刻修正で後から started_at が入る特殊系は、農家の完了記録（complete_work）後に評価できる。
-- AFTERトリガー（firehose・review_celebration＝通知）は壁の拒否時には発火しない（BEFORE拒否で挿入なし）。

create or replace function public.trg_reviews_phase_gate()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare a public.applications;
begin
  select * into a from public.applications where id = new.application_id;
  if a.id is null then
    raise exception '評価の応募が存在しません';
  end if;
  if new.direction = 'farmer_to_worker' then
    if public.app_phase(a) <> 'completed' then
      raise exception '評価は作業の完了を記録してからできます（現在の段階：%）', public.app_phase(a);
    end if;
  elsif new.direction = 'worker_to_farmer' then
    if public.app_phase(a) not in ('working','completed') then
      raise exception '評価は作業が始まってからできます（現在の段階：%）', public.app_phase(a);
    end if;
  end if;
  return new;
end; $function$;

drop trigger if exists reviews_phase_gate on public.reviews;
create trigger reviews_phase_gate
  before insert on public.reviews
  for each row execute function public.trg_reviews_phase_gate();
