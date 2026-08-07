-- ニックネーム正規化の強化（2026-08-07 追加10パターン実弾で発見した穴3+1を塞ぐ）：
-- 素通りしていたもの＝①ゼロ幅スペース挿入「はな[ZWSP]こ」②末尾BOM[FEFF]③末尾改行（btrimは
-- 半角スペースしか削らない）④全角空白だけの名前が「空」と判定されず、そのまま保存されていた
-- （見えない名前）。NFKCはゼロ幅系・改行を空白に畳まないため、明示的に処理する。
-- 手順：NFKC正規化（全角空白等→半角空白）→ ゼロ幅・不可視文字を全削除 → 両端の空白類
-- （改行・タブ含む \s）を削除 → lower。
create or replace function public.wp_nickname_norm(p text)
returns text language sql immutable as $$
  select lower(
    regexp_replace(
      regexp_replace(
        normalize(coalesce(p,''), NFKC),
        -- ZWSP/ZWNJ/ZWJ/LRM/RLM/WJ/BOM/SHY（NFKCが残す不可視文字）を全削除
        '[' || chr(8203) || chr(8204) || chr(8205) || chr(8206) || chr(8207) || chr(8288) || chr(65279) || chr(173) || ']', '', 'g'),
      '(^\s+)|(\s+$)', '', 'g')
  )
$$;

-- 既定名トリガーの「空」判定も同じ物差しに：全角空白だけ・ゼロ幅だけの名前は空として
-- 既定名（メール頭2文字・重複時は数字付き）に置き換える＝見えない名前を作らせない
create or replace function public.wp_default_nickname()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_base text; v_cand text; v_n int := 1;
begin
  if new.nickname is null or public.wp_nickname_norm(new.nickname) = '' then
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
