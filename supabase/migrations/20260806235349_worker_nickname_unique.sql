-- 働き手ニックネームの重複禁止（2026-08-07 たきと指示「同じニックネームは禁止にしよう。農家は仕方がない。禁止してはいけない」）
-- 対象は worker_profiles のみ。employer_profiles（農園名・屋号は同名があり得る）には掛けない。
-- 既存の重複（「たき」×2）は残置＝運営が利用者のデータを勝手に改名しない。
-- 本人が次にニックネームを【変更】する時から一意化が効く（変更しない保存は従来どおり通る）。
-- UNIQUE index は既存重複があるため張れない＝このトリガーが機構の壁。
-- 同時保存の競合（同名を同時に取り合う）は advisory lock で塞ぐ。

-- 正規化：全半角(NFKC)・大文字小文字・前後空白の違いだけの別名は同名とみなす
create or replace function public.wp_nickname_norm(p text)
returns text language sql immutable
as $$ select lower(normalize(btrim(coalesce(p,'')), NFKC)) $$;
revoke all on function public.wp_nickname_norm(text) from public, anon, authenticated;

create or replace function public.wp_nickname_unique()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_norm text;
begin
  v_norm := public.wp_nickname_norm(new.nickname);
  if v_norm = '' then return new; end if;  -- 空は既定名トリガー(wp_default_nickname)の領分
  if tg_op = 'UPDATE' and v_norm = public.wp_nickname_norm(old.nickname) then
    return new;  -- 変更なしの保存は通す（既存重複の残置＝グランドファーザー）
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wp_nickname:' || v_norm, 0));
  if exists (select 1 from public.worker_profiles w
              where w.auth_id <> new.auth_id
                and public.wp_nickname_norm(w.nickname) = v_norm) then
    raise exception 'このニックネームは既に使われています。別のニックネームにしてください';
  end if;
  return new;
end; $$;

drop trigger if exists trg_wp_nickname_unique on public.worker_profiles;
create trigger trg_wp_nickname_unique
  before insert or update on public.worker_profiles
  for each row execute function public.wp_nickname_unique();
-- 発火順（同イベントのBEFOREは名前順）：trg_wp_default_nickname(d) → trg_wp_nickname_unique(n)
-- ＝既定名の付与が先・一意チェックが後。名前を変える時はこの順序を壊さないこと

-- 既定ニックネーム（空のときメール頭2文字）も一意化：重複していたら数字を足す（t5 → t52 → t53…）。
-- 新規利用者の初回保存が「既定名がたまたま他人と同じ」で失敗する事故を防ぐ（入口で止めない）
create or replace function public.wp_default_nickname()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_base text; v_cand text; v_n int := 1;
begin
  if new.nickname is null or btrim(new.nickname) = '' then
    select left(u.email, 2) into v_base from auth.users u where u.id = new.auth_id;
    v_base := coalesce(nullif(btrim(v_base), ''), 'user');
    perform pg_advisory_xact_lock(hashtextextended('wp_nickname:' || public.wp_nickname_norm(v_base), 0));
    v_cand := v_base;
    while exists (select 1 from public.worker_profiles w
                   where w.auth_id <> new.auth_id
                     and public.wp_nickname_norm(w.nickname) = public.wp_nickname_norm(v_cand)) loop
      v_n := v_n + 1; v_cand := v_base || v_n::text;
    end loop;
    new.nickname := v_cand;
  end if;
  return new;
end; $$;
