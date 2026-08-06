-- 過去の求人の復元と、以後の削除の禁止（2026-08-05たきと指示
-- 「過去の求人は消すな。全て復元しろ。ただし、どのように終了したか従来の設計通りに」）。
--
-- 【背景】応募が残っているのに求人の行が消えていた（#1018・#1026・#1033・#1036）。
--   消えた経路：一時非公開（unpublish_job）が open → draft に戻すため、掲載して応募まで
--   受けた求人でも「作成中の下書き」の顔になり、下書き用の削除ボタンで消せてしまった。
--   結果、働き手の記録が求人との内部結合から落ち、はたらいた記録の画面から丸ごと消えていた。
--
-- 【① 復元】4件を jobs に戻す。どのように終了したかは従来の設計どおり＝status='closed'
--   （expire_stale_applications の「最終作業日を過ぎた求人の自動クローズ」と同じ終わり方。
--     4件とも7月の求人so、いまの設計ではすべて closed で終わっている状態が正しい）。
--   入れる値は【記録に残っているものだけ】。作物・作業は通知（notifications）に残っていた
--   最後の姿を使う。日程は #1036 のみ判明（CLAUDE.md の実績1件目：2026-07-13・17:00開始・
--   18:10終了＝50分早終い → 予定は17:00〜19:00）。分からない項目は NULL のままにする
--   ＝ダミーを入れない（憲法3条：実データ・未設定・非表示の三択）。
--   created_at は「その求人について残っている一番古い記録の時刻」を入れる（now() を入れると
--   応募より後に作られた求人という嘘になるため）。
--   farmer_id は応募の記録から確定（4件とも運営本人の自己募集）。
--
-- 【② 以後の削除の禁止】機構で止める（UIを直すだけにしない・二重の壁）。
--   消せなくなるもの：応募のある求人／一度でも掲載した求人（opened_at あり）／作業日を過ぎた求人。
--   消せるまま残すもの：一度も掲載せず応募も無い、書きかけの下書き（これは記録ではないため）。

-- ① 復元（job_number で二重登録を防ぐ＝再実行しても増えない）
insert into public.jobs (job_number, farmer_id, status, created_at, crop, task, date_start, work_time)
select v.job_number, 'af6377a6-57e4-46b3-ae3e-eebe7bfda27e'::uuid, 'closed', v.created_at,
       v.crop, v.task, v.date_start, v.work_time
from (values
  -- 記録なし（応募が1件あるだけ。作物・作業・日程は残っていない）
  (1018, timestamptz '2026-07-03 23:17:31+00', null::text, null::text, null::date, null::text),
  -- 通知に残る最後の姿（07/17 16:19 公開時）。それ以前は「ナス 摘果」だった
  (1026, timestamptz '2026-07-12 09:48:48+00', 'ブロッコリー', '収穫', null::date, null::text),
  -- 通知に残る姿（07/12 18:50）
  (1033, timestamptz '2026-07-12 08:55:00+00', 'ナス', '収穫', null::date, null::text),
  -- 実績1件目（CLAUDE.md）。17:00開始・18:10終了・50分早終い ⇒ 予定は17:00〜19:00
  (1036, timestamptz '2026-07-13 03:50:00+00', 'ナス', '支柱を立て、誘引線を巻きます！',
         date '2026-07-13', '17:00〜19:00')
) as v(job_number, created_at, crop, task, date_start, work_time)
where not exists (select 1 from public.jobs j where j.job_number = v.job_number);

-- ② 過去の求人は消せない（機構による拒否）
create or replace function public.trg_block_delete_past_job()
returns trigger
language plpgsql
as $function$
begin
  if exists (select 1 from public.applications a where a.job_number = old.job_number) then
    raise exception '応募のある求人は削除できません（記録として残します）';
  end if;
  if old.opened_at is not null then
    raise exception '一度でも掲載した求人は削除できません（記録として残します）';
  end if;
  if coalesce(old.date_end, old.date_start) < (now() at time zone 'Asia/Tokyo')::date then
    raise exception '作業日を過ぎた求人は削除できません（記録として残します）';
  end if;
  return old;
end; $function$;

drop trigger if exists block_delete_past_job on public.jobs;
create trigger block_delete_past_job
  before delete on public.jobs
  for each row execute function public.trg_block_delete_past_job();
