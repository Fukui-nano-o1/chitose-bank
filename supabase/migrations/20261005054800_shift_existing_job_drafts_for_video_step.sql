-- 作業動画ページをstep9へ挿入したため、追加前に保存された下書きの再開位置を1つ後ろへ移す。
-- 旧9=危険箇所→新10、旧10=希望→新11、旧11=確認→新12。
update public.jobs
set draft_step = draft_step + 1
where status in ('draft','pending') and draft_step between 9 and 11;
