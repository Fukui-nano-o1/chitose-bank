-- 掲載の緊急連絡先必須を解除する（2026-08-19 たきと指示「緊急連絡先必須を解除。代わりに新規登録で
-- 入力した氏名と電話番号をデフォルトに。任意で変更できるようにする」）。
-- 直前の 20260819002316 で入れた検査ブロックを、掲載時トリガーから取り除いて元に戻す。
-- 他の掲載検査（募集主・受動喫煙・就業場所・時間外労働・賃金／最低賃金）は一切触らない。
do $mig$
declare
  v_def text;
  v_start int;
  v_end int;
  v_block text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trg_job_publish_snapshot';
  if v_def is null then
    raise exception 'trg_job_publish_snapshot not found';
  end if;
  if position('emergency_contacts' in v_def) = 0 then
    raise notice 'nothing to revert';
    return;
  end if;
  v_start := position(E'    -- 緊急連絡先（2026-08-19）' in v_def);
  v_end := position(E'    if coalesce(btrim(new.address),\'\') = \'\' then\n' in v_def);
  if v_start = 0 or v_end = 0 or v_end <= v_start then
    raise exception 'block boundaries not found';
  end if;
  v_block := substring(v_def from v_start for v_end - v_start);
  v_def := replace(v_def, v_block, '');
  if position('emergency_contacts' in v_def) <> 0 then
    raise exception 'emergency check still present after removal';
  end if;
  execute v_def;
end $mig$;
