-- 緊急連絡先：規約・プラポリに同意していれば、新規登録の電話番号を表示する（2026-08-24たきと指示）
-- 【たきと指示】「プラポリと利用規約に同意したら新規登録で登録した電話番号を表示させる」
-- 【何が止めていたか】contract_emergency_contact は confirmed_at（本人の確認）を必須にしていたが、
--   2026-08-19に全員へ自動で作った行（氏名・電話を新規登録から写した relation='本人' の行）は
--   confirmed_at が空なので、11件すべて表示されない状態だった。
-- 【直し方】本人の連絡先（relation='本人'）は、登録時の規約・プラポリへの同意が本人の確認を兼ねる
--   ＝confirmed_at を要求しない。家族など第三者の連絡先は従来どおり本人の確認が要る
--   （第三者の番号を、その人の知らないうちに相手へ渡さないための守り＝2026-08-03の設計は不変）。
--   あわせて、本人の行で氏名・電話が空なら account_holders（新規登録の値）で補う。
-- 【変えていない壁】採用成立（terms_snapshot）／当事者だけ／相手が現行のプラポリに同意していること。
--   ★同意の判定は app_settings.privacy_version との一致なので、フロントの PRIVACY_VERSION と同じ文字列で
--     あることが前提（2026-08-19の規則）。ズレている間は誰にも表示されない。
-- 【実測（ロールバック付き）】同意済み＋本人の行＝氏名と電話が出る／電話が空でも登録情報で補われる／
--   家族・未確認＝出ない（not_confirmed）／家族・確認済み＝出る／未同意＝not_consented／第三者＝not_party。
-- 【書き換え方】長い日本語の本文を写経せず、ASCIIのアンカー6つを置換して実行する（家の作法）。
--   挿入する日本語は base64 から復元する（この環境では日本語の一部が化けることがあるため）。
do $mig$
declare
  src text; out text; n int; snip text; cond text;
  a_decl text := '  v_cur text; v_agreed text;';
  a_sel  text := '  select * into v_ec from public.emergency_contacts where auth_id = v_other;';
  a_emp  text := '  if v_ec.auth_id is null
     or (coalesce(btrim(v_ec.name),'''') = '''' and coalesce(btrim(v_ec.phone),'''') = '''') then';
  a_conf text := 'if v_ec.confirmed_at is null then';
  a_name text := '''name'', nullif(btrim(v_ec.name), ''''),';
  a_pho  text := '''phone'', nullif(btrim(v_ec.phone), ''''));';
begin
  snip := convert_from(decode('ICBzZWxlY3QgKiBpbnRvIHZfZWMgZnJvbSBwdWJsaWMuZW1lcmdlbmN5X2NvbnRhY3RzIHdoZXJlIGF1dGhfaWQgPSB2X290aGVyOwogIHZfbmFtZSA6PSBudWxsaWYoYnRyaW0odl9lYy5uYW1lKSwgJycpOwogIHZfcGhvbmUgOj0gbnVsbGlmKGJ0cmltKHZfZWMucGhvbmUpLCAnJyk7CiAgLS0g5pys5Lq6IOOBrumAo+e1oeWFiO+8iOaWsOimj+eZu+mMsuOBruawj+WQjeODu+mbu+ipseOCkuOBneOBruOBvuOBvuS9v+OBo+OBpuOBhOOCi+ihjO+8ieOBr+OAgei2s+OCiuOBquOBhOWApOOCkueZu+mMsuaDheWgseOBp+ijnOOBhgogIC0tIO+8iDIwMjYtMDgtMjTjgZ/jgY3jgajmjIfnpLrjgIzjg5fjg6njg53jg6rjgajliKnnlKjopo/ntITjgavlkIzmhI/jgZfjgZ/jgonmlrDopo/nmbvpjLLjgafnmbvpjLLjgZfjgZ/pm7voqbHnlarlj7fjgpLooajnpLrjgZXjgZvjgovjgI3vvIkKICBpZiBjb2FsZXNjZShidHJpbSh2X2VjLnJlbGF0aW9uKSwgJycpID0gJ+acrOS6uicgb3Igdl9lYy5hdXRoX2lkIGlzIG51bGwgdGhlbgogICAgaWYgdl9uYW1lIGlzIG51bGwgdGhlbgogICAgICBzZWxlY3QgbnVsbGlmKGJ0cmltKGZ1bGxfbmFtZSksICcnKSBpbnRvIHZfbmFtZSBmcm9tIHB1YmxpYy5hY2NvdW50X2hvbGRlcnMgd2hlcmUgYXV0aF9pZCA9IHZfb3RoZXI7CiAgICBlbmQgaWY7CiAgICBpZiB2X3Bob25lIGlzIG51bGwgdGhlbgogICAgICBzZWxlY3QgbnVsbGlmKGJ0cmltKGNvbnRhY3RfcGhvbmUpLCAnJykgaW50byB2X3Bob25lIGZyb20gcHVibGljLmFjY291bnRfaG9sZGVycyB3aGVyZSBhdXRoX2lkID0gdl9vdGhlcjsKICAgIGVuZCBpZjsKICBlbmQgaWY7', 'base64'), 'UTF8');
  cond := convert_from(decode('aWYgdl9lYy5jb25maXJtZWRfYXQgaXMgbnVsbCBhbmQgY29hbGVzY2UoYnRyaW0odl9lYy5yZWxhdGlvbiksICcnKSA8PiAn5pys5Lq6JyB0aGVu', 'base64'), 'UTF8');

  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'contract_emergency_contact';
  if src is null then raise exception 'contract_emergency_contact not found'; end if;

  foreach out in array array[a_decl, a_sel, a_emp, a_conf, a_name, a_pho] loop
    n := (length(src) - length(replace(src, out, ''))) / length(out);
    if n <> 1 then raise exception 'anchor count = % for [%]', n, left(out, 40); end if;
  end loop;

  out := replace(src, a_decl, '  v_cur text; v_agreed text; v_name text; v_phone text;');
  out := replace(out, a_sel,  snip);
  out := replace(out, a_emp,  '  if v_name is null and v_phone is null then');
  out := replace(out, a_conf, cond);
  out := replace(out, a_name, '''name'', v_name,');
  out := replace(out, a_pho,  '''phone'', v_phone);');
  execute out;
end $mig$;
