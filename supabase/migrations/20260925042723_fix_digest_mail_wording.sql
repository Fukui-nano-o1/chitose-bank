-- まとめメールの本文の助詞が1文字だけ壊れていた（' さんthat ' → ' さんが '）。
-- 日本語をタイプせず chr() で組んで直す（この環境では、しばしば「が」が "that" に化けるため）。
-- 既に直っていれば何もしない（冪等）。
do $fix$
declare v_def text; v_bad text; v_good text; v_n int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.proname = 'summarize_user_actions' and p.pronamespace = 'public'::regnamespace;
  if v_def is null then raise exception 'summarize_user_actions not found'; end if;

  v_bad  := ' ' || chr(12373) || chr(12435) || 'that ';                  -- ' さんthat '
  v_good := ' ' || chr(12373) || chr(12435) || chr(12364) || ' ';        -- ' さんが '

  v_n := (length(v_def) - length(replace(v_def, v_bad, ''))) / length(v_bad);
  if v_n = 0 then
    raise notice 'already fixed (skip)';
  elsif v_n <> 1 then
    raise exception 'expected 1 occurrence, found %', v_n;
  else
    execute replace(v_def, v_bad, v_good);
  end if;
end $fix$;
