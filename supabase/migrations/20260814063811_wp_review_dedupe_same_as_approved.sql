-- 承認済みと同一内容の自己紹介を審査に入れない（2026-08-14たきと報告
-- 「応募するたびに自己紹介の申請がくる。内容に変更はないが何度も許可している」への機構の壁）
--
-- 【再発の型】プロフィール編集画面を開いたまま運営が承認すると、画面側の「承認済みの控え」が
-- 古いまま残り、次の保存で承認済みと同一の内容が pr_pending / pr_qa_pending に再セットされる。
-- 承認直後は old.pending が null なので trg_notify_worker_profile の「変更なしスキップ」を
-- すり抜け、運営に申請メールが毎回届いていた（event_audit で 07-27 / 08-13 の再申請を実測）。
-- フロントの控え比較（2026-07-27 / 2026-08-13）はクライアントの状態に依存するので、
-- DB側にも壁を置く＝どの経路から書いても「同一内容の再審査」は機構的に起きない（二重の壁）。
--
-- 規則：
--  1. pr_pending が空白のみ → null（審査するものが無い）
--  2. pr_pending が承認済み pr と同一（btrim比較） → null
--  3. pr_qa_pending の (質問, 回答btrim) の集合が承認済み pr_qa と同一 → null
--     （並び順・重複の違いは同一とみなす。q/a と question/answer の両形式に対応）
--  4. 両方 null になったら pr_submitted_at / pr_revision_targets も消す
--     （審査待ちの列に空の申請を残さない。承認処理が pr_submitted_at を消し忘れる
--      取りこぼしもこれで自動的に塞がる）
--  5. 審査中の内容が変わらない再提出では pr_submitted_at を進めない
--     （48時間の自動公開が後ろにずれない＝2026-08-13のフロント対策のDB版）
--     ※修正依頼中（pr_submitted_at=null・pending あり）の再提出は従来どおり
--       新しい時刻で審査の列に戻る（old.pr_submitted_at is not null の条件で除外）

create or replace function public.wp_review_dedupe()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_pend_qa jsonb; v_appr_qa jsonb;
begin
  -- 1. 空白のみの審査依頼は無い
  if new.pr_pending is not null and btrim(new.pr_pending) = '' then
    new.pr_pending := null;
  end if;

  -- 2. 承認済み本文と同一なら審査に入れない
  if new.pr_pending is not null
     and btrim(new.pr_pending) = btrim(coalesce(new.pr, '')) then
    new.pr_pending := null;
  end if;

  -- 3. Q&A：正規化した (質問, 回答) の集合が承認済みと同一なら審査に入れない
  if new.pr_qa_pending is not null then
    select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v_pend_qa
      from (select distinct jsonb_build_array(
                     coalesce(e->>'q', e->>'question', ''),
                     btrim(coalesce(e->>'a', e->>'answer', ''))) as x
              from jsonb_array_elements(new.pr_qa_pending) e) s;
    select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v_appr_qa
      from (select distinct jsonb_build_array(
                     coalesce(e->>'q', e->>'question', ''),
                     btrim(coalesce(e->>'a', e->>'answer', ''))) as x
              from jsonb_array_elements(coalesce(new.pr_qa, '[]'::jsonb)) e) s;
    if v_pend_qa = v_appr_qa then
      new.pr_qa_pending := null;
    end if;
  end if;

  -- 4. 審査に出すものが無ければ、申請時刻と修正依頼の印も残さない
  if new.pr_pending is null and new.pr_qa_pending is null then
    new.pr_submitted_at := null;
    new.pr_revision_targets := null;
  end if;

  -- 5. 中身の変わらない再提出で申請時刻を進めない（48時間の自動公開が後ろにずれない）
  --    new.pr_submitted_at is not null の条件が必須：修正依頼（request_worker_pr_revision）は
  --    pending を残したまま申請時刻を null にして審査の列から外す＝その null 化を打ち消さない
  --    （導入時の実弾T4で検出・修正済み）
  if tg_op = 'UPDATE'
     and old.pr_submitted_at is not null
     and new.pr_submitted_at is not null
     and (new.pr_pending is not null or new.pr_qa_pending is not null)
     and coalesce(btrim(new.pr_pending), '') = coalesce(btrim(old.pr_pending), '')
     and coalesce(new.pr_qa_pending, '[]'::jsonb) = coalesce(old.pr_qa_pending, '[]'::jsonb) then
    new.pr_submitted_at := old.pr_submitted_at;
  end if;

  return new;
end; $$;

-- BEFORE トリガー＝AFTER の trg_notify_worker_profile より必ず先に走る。
-- 同一内容は pending が null に畳まれるため、承認直後の再保存でも申請メールは出ない
drop trigger if exists trg_wp_review_dedupe on public.worker_profiles;
create trigger trg_wp_review_dedupe
  before insert or update on public.worker_profiles
  for each row execute function public.wp_review_dedupe();

-- 掃除：承認処理が pr_submitted_at を消し忘れて残った行（審査するものが無いのに申請時刻だけ残存）
update public.worker_profiles
   set pr_submitted_at = null
 where pr_pending is null and pr_qa_pending is null and pr_submitted_at is not null;
