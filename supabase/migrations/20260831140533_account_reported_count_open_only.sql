-- アカウント一覧（admin_list_accounts）の reported を「未対応（status='open'）の通報だけ」に。
-- 従来は job_reports を状態を見ずに全件数えていたため、対応済みにしても「通報」バッジが永久に残った。
-- 契機：2026-08-31 ねっこ農園のアカウントカードに「通報」＝実体は表示確認用のデモ通報2件（#1232・
-- 本文に【デモ】と明記）だった。デモ行は削除済み（DMLのコンテンツ行so本migrationには含めない）。
-- 関数本体は書き写さず、現物（pg_get_functiondef）にアンカー1箇所のreplaceを当てて作り直す（置換件数を検査・冪等）。
do $$
declare
  src text;
  cnt int;
  anchor constant text := 'where j2.farmer_id = u.id';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_list_accounts';

  if src is null then
    raise exception 'admin_list_accounts not found';
  end if;

  -- 冪等：既に jr.status を見ていれば何もしない
  if position('jr.status' in src) > 0 then
    return;
  end if;

  cnt := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if cnt <> 1 then
    raise exception 'anchor count % (expected 1) - aborting', cnt;
  end if;

  src := replace(src, anchor, anchor || ' and jr.status = ''open''');
  execute src;
end $$;
