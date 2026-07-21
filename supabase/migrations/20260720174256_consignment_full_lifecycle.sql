-- 委託レーン本稼働（管理者限定）：雇用レーンの部品の写像
-- ①合意時スナップショット ②日次進捗ログ ③履行サマリー

-- ① 合意の瞬間に仕様書を凍結（契約スナップショットの写像）
alter table public.consignment_deals
  add column if not exists spec_snapshot jsonb,
  add column if not exists snapshot_at timestamptz;

create or replace function public.trg_consignment_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'agreed' and coalesce(old.status,'') <> 'agreed'
     and new.spec_snapshot is null then
    new.spec_snapshot := new.spec;
    new.snapshot_at := now();
    new.agreed_at := coalesce(new.agreed_at, (now() at time zone 'Asia/Tokyo')::date);
  end if;
  return new;
end; $$;
drop trigger if exists consignment_snapshot on public.consignment_deals;
create trigger consignment_snapshot before update on public.consignment_deals
  for each row execute function public.trg_consignment_snapshot();

-- ② 日次進捗ログ（打刻の写像・履行リスク③「遅延を3日目に発見」）
create table if not exists public.consignment_progress (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.consignment_deals(id) on delete cascade,
  work_date date not null default (now() at time zone 'Asia/Tokyo')::date,
  hours numeric,                -- 実働時間（チーム合計）
  workers int,                  -- 人数
  yield_boxes int,              -- 収量（箱）
  note text default '',
  created_at timestamptz not null default now()
);
alter table public.consignment_progress enable row level security;
create policy "cprog admin only" on public.consignment_progress
  for all to authenticated
  using (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()))
  with check (exists (select 1 from public.app_admins a where a.auth_id = auth.uid()));

-- ③ 履行サマリー（実績台帳の写像・処理能力/10aの自動算出）
create or replace function public.consignment_summary(p_deal_id uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'total_hours',  coalesce(sum(p.hours), 0),
    'total_boxes',  coalesce(sum(p.yield_boxes), 0),
    'work_days',    count(distinct p.work_date),
    'hours_per_10a', case when d.area_a > 0
        then round(coalesce(sum(p.hours),0) / d.area_a * 10, 1) else null end,
    'first_day', min(p.work_date), 'last_day', max(p.work_date)
  )
  from public.consignment_deals d
  left join public.consignment_progress p on p.deal_id = d.id
  where d.id = p_deal_id
  group by d.area_a;
$$;
revoke all on function public.consignment_summary(uuid) from public, anon;
