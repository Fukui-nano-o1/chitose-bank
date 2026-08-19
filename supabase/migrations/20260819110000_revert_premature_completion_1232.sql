-- 早すぎた完了を作業中に戻す（2026-08-19たきと指示「完了ラベルが貼られたままだ」）
--
-- 同日の壁（20260819094803）で「完了は最終作業日の仕事が終わってから」にしたが、
-- それ以前に付いてしまった完了ラベルは残ったままだった。実測で、期限前に完了している
-- 応募は1件だけ（#1232／作業日 8/18・8/20・8/21・8/24・8/31／6:00〜9:00＝期限 8/31 09:00 に対し、
-- 8/19 14:19 JST に手で完了。auto_completed=false）。他の完了4件は期限を過ぎており正しい。
--
-- 戻すもの：status（completed→working）・work_completed_at・attended。
--   started_at（8/18 06:00）はそのまま＝実際に作業は始まっている。
-- 戻さないもの：この応募に入っている評価1件。記録は消さない（行動記録の憲法）。
--   ★status を戻すと status_changed_at のトリガーが動き、この訂正自体も記録に残る。
--
-- ★条件つきの1行更新にしてある：期限を過ぎていない・手で完了された行だけ。
--   8/31 を過ぎてからこのファイルが再実行されても、条件に合わず何も起きない。
update public.applications a
   set status = 'working', work_completed_at = null, attended = null
 where a.id = '01e54f18-91c7-4b48-9802-0e9eae916829'
   and a.status = 'completed'
   and coalesce(a.auto_completed, false) = false
   and now() < public.app_work_due_at(a.id);

-- 評価が既に入っている応募を、あとでもう一度完了する時に詰まらないようにする。
-- reviews は UNIQUE(application_id, direction) なので、上の訂正で評価だけが残った応募は
-- 次に「バイトの評価」を押した時に一意制約で失敗し、完了そのものができなくなる
-- （submit_farmer_review は complete_work → reviews への insert を同じ取引で行うため）。
-- do nothing にして、完了は通し、評価は【最初の記録を残す】（追記のみ・上書きしない）。
-- 二度押し・再送の取りこぼしにも効く。
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='submit_farmer_review';
  if position('on conflict (application_id, direction) do nothing' in src) > 0 then return; end if;
  src := replace(src,
'          nullif(trim(coalesce(p_public_comment,'''')),''''), nullif(trim(coalesce(p_private_memo,'''')),''''));',
'          nullif(trim(coalesce(p_public_comment,'''')),''''), nullif(trim(coalesce(p_private_memo,'''')),''''))
  on conflict (application_id, direction) do nothing;');
  execute src;
end $$;
