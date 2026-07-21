-- 法務ゲート（DB側）：特定募集情報等提供事業者の届出が受理されるまで、
-- 第三者（運営者以外）の求人は open にできない。
-- 運営者本人の求人＝自己募集であり職安法の仲介規制の対象外（CLAUDE.md 2026-07-13訂正）。
-- 解禁は app_settings の1行UPDATE（デプロイ不要）。

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
-- ポリシーは作らない：アプリからは読めない・変えられない。判定はトリガー（definer権限）のみ。

insert into public.app_settings (key, value)
values ('third_party_publish_allowed', 'false')
on conflict (key) do nothing;

create or replace function public.trg_block_third_party_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'open'
     and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    -- 運営者（app_admins）の自己募集は常に可
    if exists (select 1 from public.app_admins a where a.auth_id = new.farmer_id) then
      return new;
    end if;
    -- 第三者の求人は届出受理フラグが立つまで公開不可
    if not exists (select 1 from public.app_settings
                    where key = 'third_party_publish_allowed' and value = 'true') then
      raise exception '第三者の求人は、特定募集情報等提供事業者の届出が完了するまで公開できません（CLAUDE.md 2026-07-13）';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists block_third_party_open on public.jobs;
create trigger block_third_party_open
  before insert or update of status on public.jobs
  for each row execute function public.trg_block_third_party_open();