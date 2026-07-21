-- 新規登録①（account_holders）の許可リスト。
-- 従来はコード（ACCOUNT_ALLOWLIST）とRLS（ANY ARRAY）の2箇所に同じ4メールを書いていた。
-- 片方だけ更新すると壊れるため、真実の源をこの1テーブルに集約する（設計原則②）。
-- 以後、人を追加するときはこの表に1行INSERTするだけでよい。コード変更もデプロイも不要。
create table if not exists public.account_allowlist (
  email text primary key,
  label text,
  added_at timestamptz not null default now()
);

alter table public.account_allowlist enable row level security;
-- 読み書きポリシーは作らない。アプリから一覧は見えない・変更できない。
-- 判定は下の security definer 関数だけが行う。

insert into public.account_allowlist (email, label) values
  ('t5fki6643qty@gmail.com', 'たきと（運営）'),
  ('hmktsr15231@gmail.com',  '家族'),
  ('wuren9042@gmail.com',    '家族'),
  ('coirakoira@gmail.com',   '家族'),
  ('taniki46@gmail.com',     '招待（信頼できる知人）'),
  ('abeken_0905@icloud.com', '招待（信頼できる知人）')
on conflict (email) do nothing;

-- 自分が許可されているかを返す。アプリ側もRLS側も、必ずこの関数を通す。
create or replace function public.am_i_account_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.account_allowlist
     where email = (auth.jwt() ->> 'email')
  );
$$;

grant execute on function public.am_i_account_allowed() to authenticated;

-- RLSポリシーを、ハードコード配列から関数呼び出しに差し替える
drop policy if exists own_insert on public.account_holders;
create policy own_insert on public.account_holders
  for insert to authenticated
  with check (auth.uid() = auth_id and public.am_i_account_allowed());