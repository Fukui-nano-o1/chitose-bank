-- 働き手のニックネーム未設定対策（2026-07-16）：
-- insert/update時に nickname が空なら、本人のメールアドレス先頭2文字を自動挿入する。
-- security definer＝auth.usersを読むため（呼び出し元の権限では読めない）。挿入するのは2文字のみ（メール全体は出さない）
create or replace function public.wp_default_nickname()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.nickname is null or btrim(new.nickname) = '' then
    select left(u.email, 2) into new.nickname from auth.users u where u.id = new.auth_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wp_default_nickname on public.worker_profiles;
create trigger trg_wp_default_nickname
  before insert or update on public.worker_profiles
  for each row execute function public.wp_default_nickname();

-- 既存行の埋め戻し（nickname空のみ）
update public.worker_profiles wp
   set nickname = left(u.email, 2)
  from auth.users u
 where u.id = wp.auth_id
   and (wp.nickname is null or btrim(wp.nickname) = '');