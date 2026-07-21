-- 評価テーブル第一版（2026-07-13・実績1件目の聴取メモから設計）
-- 思想：公開＝客観的事実のはい/いいえのみ（ポジティブのみ表示・全員同形）／非公開＝本人メモ
-- 職安法ガード：ランキング・スコア・レコメンドには使わない（事実の陳列まで）
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id),
  reviewer_id uuid not null,          -- 評価した人
  reviewee_id uuid not null,          -- 評価された人
  direction text not null check (direction in ('farmer_to_worker','worker_to_farmer')),
  -- 公開軸（はい=true のみ表示に使う設計。いいえは公開画面に出さない）
  on_time boolean,                    -- 時間どおりに来た/始まった
  as_described boolean,               -- 打合せ・求人内容どおりだった
  followed_instructions boolean,      -- 指示・安全に従って動けた（働き手向け）/ 安全に配慮した（農家向け）
  completed_work boolean,             -- 最後まで作業をやり切った / 報酬が約束どおり支払われた
  want_again boolean,                 -- また呼びたい / また働きたい
  private_memo text,                  -- 非公開。本人（reviewer）だけが見える
  created_at timestamptz not null default now(),
  unique (application_id, direction)
);

alter table public.reviews enable row level security;

-- 書き込み：当事者本人のみ（自分がreviewerで、その応募の当事者であること）
create policy "review insert own" on public.reviews
  for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and exists (select 1 from public.applications a
                 where a.id = application_id
                   and (a.worker_id = auth.uid() or a.farmer_id = auth.uid()))
  );

-- 読み取り：自分が書いたもの（メモ含む）は全列。他人の評価の公開列は後日ビューで設計
create policy "review select own" on public.reviews
  for select to authenticated
  using (reviewer_id = auth.uid());

-- ===== 実績1件目の記録 =====
-- #1036 を completed に（労働は実施済み・2026-07-13 17:00-18:10頃・50分早終い）
update public.applications
   set status = 'completed'
 where job_number = 1036 and status = 'approved';

-- 求人も閉じる（⑨の暫定：closedはUI未対応のためdraftではなくopenのまま残さない）
update public.jobs set status = 'draft' where job_number = 1036;

-- 評価1件目：農家→働き手（聴取メモそのまま。公開軸は事実で入力・メモは非公開）
insert into public.reviews (application_id, reviewer_id, reviewee_id, direction,
  on_time, as_described, followed_instructions, completed_work, want_again, private_memo)
select a.id, a.farmer_id, a.worker_id, 'farmer_to_worker',
  true,   -- 時間どおりに来た（遅刻の言及なし）
  true,   -- 求人内容どおりの作業を実施
  false,  -- 指示への応答：見本と違う成果物・指示が届かない
  false,  -- やり切り：後片付け未実施・作業の押し返しあり
  false,  -- また呼びたい：いいえ
  '2026-07-13 ナス支柱立て・誘引（17:00開始・50分早終い）。' ||
  '暑さですぐばてる。服装が不適切（短パン+冬用ランニング・熱中症リスク）。' ||
  '休憩を自己判断で取り報告なし。ワイヤーカットは見本を渡したが原型のみで完成形にならず。' ||
  '指示を面倒がり押し返す場面あり。後片付け未実施。丁寧に指示しても届かないことがある。' ||
  '【運用への学び】服装・暑さ対策は求人側の事前指定に昇格。確認カード（⑦）に服装確認を含める。'
from public.applications a
where a.job_number = 1036 and a.status = 'completed'
on conflict (application_id, direction) do nothing;

select
  (select status from public.applications where job_number = 1036) as application_status,
  (select count(*) from public.reviews) as reviews_total;