-- ① 運営管理情報テーブル（非公開・PIIの箱）
-- 目的: 責任特定（封筒送達）／18歳未満排除／規約同意の証拠保全
create table account_holders (
  id            uuid primary key default gen_random_uuid(),
  auth_id       uuid not null unique references auth.users(id) on delete cascade,

  full_name     text not null,                 -- 氏名（責任特定）
  postal_code   text not null,                 -- 郵便番号（封筒の到達率）
  address       text not null,                 -- 住所（送達先）
  birth_date    date not null,                 -- 生年月日（18歳判定のみ）
  entity_type   text not null
                  check (entity_type in ('individual','corporate')), -- 個人/法人の区別だけ

  -- 連絡チャネル（OTP認証済みの値を自動投入。email or 電話、最低1つ必須）
  contact_email text,
  contact_phone text,

  -- 規約同意の証拠（どの版に・いつ同意したか）
  agreed_terms_version   text not null,
  agreed_privacy_version text not null,
  agreed_at              timestamptz not null default now(),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint contact_present
    check (contact_email is not null or contact_phone is not null)
);

-- 18歳未満をDB層でも止める（CHECKはcurrent_dateを使えないのでtrigger）
create or replace function enforce_min_age()
returns trigger language plpgsql as $$
begin
  if new.birth_date > (current_date - interval '18 years') then
    raise exception '18歳未満は登録できません';
  end if;
  return new;
end;
$$;

create trigger trg_min_age
  before insert or update on account_holders
  for each row execute function enforce_min_age();

-- updated_at 自動更新
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trg_updated_at
  before update on account_holders
  for each row execute function set_updated_at();

-- RLS: 本人の自分の行だけ。管理者ポリシーは意図的に作らない。
alter table account_holders enable row level security;

create policy own_select on account_holders
  for select using (auth.uid() = auth_id);

create policy own_insert on account_holders
  for insert with check (auth.uid() = auth_id);

create policy own_update on account_holders
  for update using (auth.uid() = auth_id) with check (auth.uid() = auth_id);