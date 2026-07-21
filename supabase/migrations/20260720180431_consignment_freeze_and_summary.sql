-- 委託レーン本稼働（2026-07-21）：合意時の仕様書凍結トリガー＋履行サマリーRPC。契約記録と同じ方式。
-- ① 合意(agreed)に遷移した瞬間、specをspec_snapshotへ凍結（一度きり・coalesce）。agreed_atも記録
create or replace function public.trg_consign_freeze_spec()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'agreed' and (tg_op = 'UPDATE' and old.status is distinct from 'agreed') then
    if new.spec_snapshot is null then
      new.spec_snapshot := new.spec;
      new.snapshot_at := now();
    end if;
    if new.agreed_at is null then new.agreed_at := (now() at time zone 'Asia/Tokyo')::date; end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_consign_freeze_spec on public.consignment_deals;
create trigger trg_consign_freeze_spec before update on public.consignment_deals
for each row execute function public.trg_consign_freeze_spec();

-- ② 履行サマリー：日次進捗を集計（実働合計h・箱数・稼働日数・延べ人数・10aあたり時間）。管理者のみ
create or replace function public.consignment_summary(p_deal_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_area numeric; v_hours numeric; v_boxes int; v_days int; v_workers int;
begin
  if not exists (select 1 from public.app_admins a where a.auth_id = auth.uid()) then
    return json_build_object('ok', false, 'reason', 'not_admin');
  end if;
  select coalesce(area_a, nullif(btrim(spec->>'area_a'),'')::numeric) into v_area
    from public.consignment_deals where id = p_deal_id;
  select coalesce(sum(hours),0), coalesce(sum(yield_boxes),0), count(distinct work_date), coalesce(sum(workers),0)
    into v_hours, v_boxes, v_days, v_workers
    from public.consignment_progress where deal_id = p_deal_id;
  return json_build_object('ok', true,
    'total_hours', v_hours, 'total_boxes', v_boxes, 'work_days', v_days, 'total_workers', v_workers,
    'area_a', v_area,
    'hours_per_10a', case when v_area is not null and v_area > 0 then round(v_hours * 10 / v_area, 1) else null end);
end; $$;