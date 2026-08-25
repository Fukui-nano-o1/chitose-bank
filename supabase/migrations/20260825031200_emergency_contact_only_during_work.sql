-- 緊急連絡先は「仕事の開始から終了まで」だけ表示する
-- （2026-08-25 たきと指示「緊急連絡先ボタンは仕事の開始から終了まで。それ以外はいかなる理由でも見せない」）。
--
-- 開始＝applications.started_at（作業開始時刻に自動で入る）
-- 終了＝applications.work_completed_at（完了の記録。最終作業日の終了時刻に自動でも入る）
-- どちらかが分からない時は「見せない」に倒す（フェイルクローズ）。
--
-- ★フロントの写しは lib/utils.js の isWorkWindowOpen＝ContractEmergencyContact に workWindow で渡す。
--   片方だけ変えると「ボタンは出るのに中身が出ない（またはその逆）」になるので、必ず両方直すこと。
-- ★関数本体は写経せず、いまの本番の定義に検査ブロックを差し込んで作り直す（長い日本語の写し間違い防止）。
--   冪等：すでに not_working を返す定義なら何もしない。
do $mig$
declare
  v_def text;
  a1 text := E'  v_w uuid; v_f uuid; v_snap jsonb; v_other uuid;\n';
  a2 text := E'  select worker_id, farmer_id, terms_snapshot into v_w, v_f, v_snap\n';
  a3 text := E'  v_other := case when auth.uid() = v_f then v_w else v_f end;\n';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'contract_emergency_contact';
  if v_def is null then
    raise exception 'contract_emergency_contact not found';
  end if;
  if position('not_working' in v_def) > 0 then
    raise notice 'already gated';
    return;
  end if;
  if position(a1 in v_def) = 0 or position(a2 in v_def) = 0 or position(a3 in v_def) = 0 then
    raise exception 'anchors not found';
  end if;

  v_def := replace(v_def, a1,
    a1 || E'  v_started timestamptz; v_completed timestamptz;\n');
  v_def := replace(v_def, a2,
    E'  select worker_id, farmer_id, terms_snapshot, started_at, work_completed_at\n    into v_w, v_f, v_snap, v_started, v_completed\n');
  v_def := replace(v_def, a3,
    E'  -- 仕事の開始から終了までの間だけ表示する（2026-08-25たきと指示「緊急連絡先ボタンは仕事の\n'
 || E'  -- 開始から終了まで。それ以外はいかなる理由でも見せない」）。開始＝started_at（自動開始）、\n'
 || E'  -- 終了＝work_completed_at（完了の記録）。どちらかが分からない時は見せない側に倒す。\n'
 || E'  if v_started is null or v_completed is not null then\n'
 || E'    return json_build_object(''ok'', false, ''reason'', ''not_working'',\n'
 || E'      ''message'', ''緊急連絡先は、仕事の開始から終了までの間だけ表示されます'');\n'
 || E'  end if;\n\n' || a3);

  execute v_def;
end $mig$;
