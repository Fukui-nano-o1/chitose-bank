-- 求人を取り下げたら、そのチャットは「見送り」に統一（2026-08-28たきと指示）
--
-- 従来の unpublish_job は 応募中・面接中 だけを見送りにし、採用済み（契約成立・作業前）は
-- そのまま残していた。ので取り下げた求人のチャットに「採用」の帯が残り続けた
-- （実データ：#1046×1・#1053×2 が採用のまま＝見送りと採用が混在）。
-- ① これからの取り下げ＝採用済み（作業前）も見送りにする。作業が始まっている（working）・
--    完了した（completed）応募は触らない＝働いた事実の記録は取り下げで消さない。
-- ② 農家への確認メールの文面を新しい挙動に合わせる。
-- ③ 既存の取り下げ済み求人に残る採用（作業前）もバックフィルで見送りに＋チャットに理由を投函。
--    記録は消さない＝status の変更だけ（terms_confirmed_*・terms_snapshot は不変なので
--    労働条件通知書・本名の開示はこれまでどおり）。
-- ★関数本文には日本語のメール文面が多いので書き写さず、現物を replace して作り直す（置換件数を検査）。
do $$
declare
  src text; n int; i int;
  reps text[][] := array[
    ['in (''applied'',''interview'')', 'in (''applied'',''interview'',''contracted'')', '1'],
    ['応募中・面接中だった ', '作業が始まる前だった ', '2'],
    [' 件の応募は見送りになり、応募者にお知らせしました。', ' 件の応募（応募中・面接中・採用済み）は見送りになり、応募者にお知らせしました。', '2'],
    ['応募中・面接中の応募はありませんでした。', '見送りになる応募はありませんでした。', '2'],
    ['採用が決まっている方はそのままです。', '作業が始まっている方・完了した方はそのままです。', '4']
  ];
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'unpublish_job';
  if src is null then raise exception 'unpublish_job not found'; end if;
  if position('''contracted''' in src) > 0 then return; end if;  -- 適用済み（冪等）
  for i in 1 .. array_length(reps, 1) loop
    n := (length(src) - length(replace(src, reps[i][1], ''))) / length(reps[i][1]);
    if n <> reps[i][3]::int then raise exception 'anchor % x% (expected %)', i, n, reps[i][3]; end if;
    src := replace(src, reps[i][1], reps[i][2]);
  end loop;
  execute src;
end $$;

-- ③ バックフィル：取り下げ済み（一時非公開）の求人に残る採用（作業前）を見送りに。
--    対象は app_phase='contracted' だけ＝working/completed は選ばれない。冪等（実行後は rejected なので再選択されない）。
--    メール・お知らせは送らない（取り下げ自体は数週間前の出来事なので、今さらの通知は混乱のもと）。
--    代わりにチャットへ理由を投函＝見送りの帯だけが突然付く、を作らない（記録から読める状態にする）。
do $$
declare r record;
begin
  for r in
    select a.id, j.farmer_id
      from public.applications a
      join public.jobs j on j.job_number = a.job_number
     where j.unlisted_reason = 'unpublished'
       and j.status = 'draft'
       and public.app_phase(a) = 'contracted'
  loop
    update public.applications
       set status = 'rejected', decided_at = coalesce(decided_at, now()), rejected_reason = 'unpublished'
     where id = r.id;
    begin
      insert into public.messages (application_id, sender_id, body)
      values (r.id, r.farmer_id,
        'この求人は、募集主が掲載を取り下げたため募集を終了しました。' ||
        'ご応募いただいたのに、お力になれずすみません。またの機会によろしくお願いします。');
    exception when others then null; end;
  end loop;
end $$;
