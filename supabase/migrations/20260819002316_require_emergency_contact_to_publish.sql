-- 掲載にも緊急連絡先を必須にする（2026-08-19 たきと指示「緊急連絡先が求人掲載と求人応募に必須条件」）
-- 応募側は既に必須（is_worker_profile_ready の4項目の②・migration 20260817100444）。
-- 掲載側だけ非対称に抜けていたので、掲載時トリガーに同じ検査を足して揃える。
--
-- ★関数本体を写経せず、いまの本番の定義（pg_get_functiondef）に検査ブロックを差し込んで作り直す。
--   長い日本語のメッセージを書き写すと化ける事故（2026-08-16の教訓）を構造的に避ける。
--   冪等：すでに emergency_contacts を見ている定義なら何もしない。
--   差し込み位置が1箇所でなければ中止（将来の改修で本文が変わったら、気づかず素通りさせない）。
--
-- 発火条件は既存のまま＝draft→pending/open か pending/open での直INSERT。
-- pending→open（運営の公開）では再検査しない＝申請時の内容を維持する従来の設計を崩さない。
-- 判定は emergency_contacts（self-only RLS）の氏名または電話のどちらか＝
-- is_worker_profile_ready・EmergencyContactBox の保存単位と同じ物差し。
do $mig$
declare
  v_def text;
  v_anchor text := E'    if coalesce(btrim(new.address),\'\') = \'\' then\n';
  v_add text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trg_job_publish_snapshot';
  if v_def is null then
    raise exception 'trg_job_publish_snapshot が見つかりません';
  end if;
  if position('emergency_contacts' in v_def) > 0 then
    raise notice '緊急連絡先の検査はすでに入っています（何もしません）';
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception '差し込み位置（就業場所の検査）が1箇所ではありません。手で確認してください';
  end if;

  v_add := E'    -- 緊急連絡先（2026-08-19）：働き手側と同じく雇い手にも必須。事故が起きた時に\n'
        || E'    -- 家族へ連絡できる状態を、掲載の前提にする（開示は採用成立後の相手方のみ・2026-08-03の窓口作法は不変）\n'
        || E'    if not exists (\n'
        || E'      select 1 from public.emergency_contacts e\n'
        || E'       where e.auth_id = new.farmer_id\n'
        || E'         and (coalesce(btrim(e.name),\'\') <> \'\' or coalesce(btrim(e.phone),\'\') <> \'\')\n'
        || E'    ) then\n'
        || E'      raise exception \'緊急連絡先の登録が必要です（プロフィールの「緊急連絡先」で登録できます）\';\n'
        || E'    end if;\n';

  execute replace(v_def, v_anchor, v_add || v_anchor);
end $mig$;
