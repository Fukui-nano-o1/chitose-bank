-- リピート即決の判定を「また呼びたい名簿（repeat_roster）」に一本化する。
-- 経緯：判定は reviews.want_again だけを見ていたが、画面の説明も労働局への照会内容（2026-07-16）も
-- 「お気に入り登録した方」＝名簿の側だった。名簿から解除しても即決が止まらず、reviews には
-- UPDATE/DELETE ポリシーが無いため農家に撤回の手段が無かった（2026-08-19 実機確認）。
-- 効果の範囲は不変＝rr.farmer_id = new.farmer_id（その求人の所有者）so、登録していない他の求人者の
-- 求人へは一切波及しない（労働局回答③の違法型に該当しない）。
--
-- ★本文には日本語のメール文面が入っているため、関数を書き写さない。現物（pg_get_functiondef）の
--   判定の1箇所だけを置換して execute する（写経ミスと文字化けを構造的に防ぐ・2026-08-16の教訓）。
do $$
declare v_def text; v_old text; v_new text; v_cnt int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trg_instant_approve';
  if v_def is null then raise exception 'trg_instant_approve が見つかりません'; end if;

  v_old := 'select exists (
    select 1 from public.reviews r
     where r.reviewer_id = new.farmer_id and r.reviewee_id = new.worker_id
       and r.direction = ''farmer_to_worker'' and r.want_again = true
  ) into v_want;';
  v_new := 'select exists (
    select 1 from public.repeat_roster rr
     where rr.farmer_id = new.farmer_id and rr.worker_id = new.worker_id
  ) into v_want;';

  v_cnt := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_cnt <> 1 then
    raise exception '置換対象が % 箇所（1箇所であること）。定義が変わっている可能性がある', v_cnt;
  end if;

  execute replace(v_def, v_old, v_new);
end $$;
