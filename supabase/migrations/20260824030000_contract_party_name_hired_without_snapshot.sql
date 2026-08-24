-- 凍結記録が無い採用でも、当事者の氏名を返す（2026-08-24たきと指示「通知書の提供は義務だ」）
-- 【何があったか】contract_party_name は「terms_snapshot があること」を契約成立の印にしていた。
--   しかし採用の凍結（terms_snapshot）は2026-08-02からの仕組みで、それ以前の採用と、
--   2026-08-05に記録を入れ直した分（#1046・#1053の1件・#1054/#1055/#1056）は凍結が無い。
--   双方の確認時刻（terms_confirmed_worker_at / terms_confirmed_farmer_at）は揃っている＝
--   契約は現に成立しているのに、労働条件通知書の宛名が「記録にありません」になっていた。
-- 【直し方】契約成立の判定を「凍結がある、または双方の確認時刻が揃っている」に広げた。
--   2026-07-30裁定(B)は「契約成立後（terms_snapshot が存在する＝双方が確認カードを確認した後）」と
--   両者を同じものとして書いており、確認時刻が揃っている行はその「契約成立後」に当たる。
--   採用に達していない応募は従来どおり not_contracted、第三者は not_party（実測で確認）。
-- 【氏名の出どころ】凍結名（party_names）が無い行は、従来からある account_holders の現在値で代替する
--   （この分岐は元からあった＝2026-08-02より前の旧契約のための道）。
-- 【書き換え方】長い日本語の本文を写経せず、ASCIIのアンカー3つを1箇所ずつ置換して実行する（家の作法）。
do $mig$
declare src text; out text; n int;
  a1 text := 'declare v_w uuid; v_f uuid; v_snap jsonb; v_name text; v_other uuid;';
  a2 text := 'select worker_id, farmer_id, terms_snapshot into v_w, v_f, v_snap';
  a3 text := 'if v_snap is null then';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'contract_party_name';
  if src is null then raise exception 'contract_party_name not found'; end if;
  foreach out in array array[a1, a2, a3] loop
    n := (length(src) - length(replace(src, out, ''))) / length(out);
    if n <> 1 then raise exception 'anchor % count = %', out, n; end if;
  end loop;
  out := replace(src, a1, 'declare v_w uuid; v_f uuid; v_snap jsonb; v_name text; v_other uuid; v_cw timestamptz; v_cf timestamptz;');
  out := replace(out, a2, 'select worker_id, farmer_id, terms_snapshot, terms_confirmed_worker_at, terms_confirmed_farmer_at into v_w, v_f, v_snap, v_cw, v_cf');
  out := replace(out, a3, 'if v_snap is null and (v_cw is null or v_cf is null) then');
  execute out;
end $mig$;
