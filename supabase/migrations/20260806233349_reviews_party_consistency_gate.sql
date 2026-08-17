-- レビュー捏造の穴を塞ぐ（2026-08-06 実機一周④で発見）。
-- 穴：reviews の INSERT ポリシーは「投稿者が application_id の当事者か」しか見ておらず、
-- reviewee_id と direction が その応募の相手方・向きと一致するかを検証していなかった。
-- ＝当事者である自分の応募に、被評価者を【無関係の第三者】にすり替えた評価を捏造でき、
--   worker_trust_info に反映されて任意の相手の評判を汚染できた（実測 0→1）。
-- 対処：BEFORE INSERT トリガーで、レビュー行がその応募の当事者関係・向きと厳密に一致することを
-- 機構的に強制する（UI/RLSに依存しない二重の壁。trg_block_third_party_open 等と同じ思想）。
--   direction='farmer_to_worker' ⟹ reviewer=応募の農家 ∧ reviewee=応募の働き手
--   direction='worker_to_farmer' ⟹ reviewer=応募の働き手 ∧ reviewee=応募の農家
-- 正規の2経路（submit_farmer_review／WorkerApplicationsの直INSERT）は既にこの整合形so無傷。
-- ★status='completed' 要求は入れない：働き手経路は confirm_end 直後（completed遷移前の瞬間があり得る）so、
--   状態要求で正当な評価を弾く危険がある。捏造は「reviewee のすり替え」が本体so、
--   当事者・向きの一致だけで穴は完全に塞がる。
-- 検証済み（ロールバック付き実弾）：捏造（reviewee=無関係）拒否／向きすり替え拒否／
--   正規 farmer_to_worker 通過／正規 worker_to_farmer 通過／被害者への汚染ゼロ。

create or replace function public.trg_reviews_party_consistency()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_worker uuid; v_farmer uuid;
begin
  select worker_id, farmer_id into v_worker, v_farmer
    from public.applications where id = new.application_id;
  if v_worker is null then
    raise exception 'レビューの応募が存在しません';
  end if;

  if new.direction = 'farmer_to_worker' then
    if new.reviewer_id <> v_farmer or new.reviewee_id <> v_worker then
      raise exception 'レビューの当事者が応募と一致しません（farmer_to_worker は 農家→働き手のみ）';
    end if;
  elsif new.direction = 'worker_to_farmer' then
    if new.reviewer_id <> v_worker or new.reviewee_id <> v_farmer then
      raise exception 'レビューの当事者が応募と一致しません（worker_to_farmer は 働き手→農家のみ）';
    end if;
  else
    raise exception 'direction が不正です: %', new.direction;
  end if;

  return new;
end; $function$;

drop trigger if exists reviews_party_consistency on public.reviews;
create trigger reviews_party_consistency
  before insert on public.reviews
  for each row execute function public.trg_reviews_party_consistency();
