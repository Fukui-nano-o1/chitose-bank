-- 運営DMのプッシュ通知の行き先を、チャット一覧（/#/chats）から運営チャットのページ（/#/chat/admin）へ。
-- 2026-08-24たきと指示「運営だけボックス展開はおかしい。ページ遷移だ。運営チャットは新しいリンクを」で
-- 運営チャットがページになったため、通知タップでそのスレッドが直接開くようにする（当事者チャットと同じ）。
-- ★関数本文には日本語（'運営'）が入っているので書き写さず、現物を replace して作り直す（置換件数を検査）。
do $$
declare src text; n int;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace
   where n2.nspname='public' and p.proname='push_payload';
  if src is null then raise exception 'push_payload not found'; end if;
  if position('''/#/chat/admin''' in src) > 0 then return; end if;  -- 適用済み（冪等）
  n := (length(src) - length(replace(src, '''/#/chats''', ''))) / length('''/#/chats''');
  if n <> 1 then raise exception 'expected exactly 1 occurrence of /#/chats, found %', n; end if;
  src := replace(src, '''/#/chats''', '''/#/chat/admin''');
  execute src;
end $$;
-- バックエンド専用（2026-08-18の作成時と同じ）：作り直しの既定付与を残さない
revoke all on function public.push_payload(text, uuid) from public, anon, authenticated;
