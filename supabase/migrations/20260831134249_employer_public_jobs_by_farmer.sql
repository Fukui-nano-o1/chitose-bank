-- 農家プレビューの「記録」タブに求人カードを並べる（2026-08-31たきと指示
-- 「記録ページをAirbnbにして。応募中と終了した求人は求人カードとして表示」）。
-- 既存 employer_public_jobs は求人番号からしか引けず、プレビューは farmer_id しか持たないため、
-- farmer_id で引く姉妹関数を新設する。
-- ★返すのは jobs_public の行だけ＝公開の姿（anonマスク・アカウント停止の除外・open または満員closed）を
--   そのまま継承する。開示は広げない（jobs_public に無い求人はここでも出ない）。
-- ★farmer_id（auth_id）は employer_profiles_public がログイン利用者に公開している識別子＝
--   これを鍵に公開求人を引けるのは「求人詳細→その農家の過去の求人」と同じ範囲で、新しい開示ではない。
create or replace function public.employer_public_jobs_by_farmer(p_farmer_id uuid)
returns setof jobs_public
language sql
security definer
set search_path to 'public'
as $$
  select jp.*
    from public.jobs_public jp
   where jp.job_number in (
     select j.job_number from public.jobs j where j.farmer_id = p_farmer_id
   )
$$;

-- ログイン利用者専用（プレビューはログイン後の画面からしか開かない）。
-- revoke は from public と from anon の両方に撃つ（2026-08-06の教訓：default privileges が明示付与する）
revoke all on function public.employer_public_jobs_by_farmer(uuid) from public, anon;
grant execute on function public.employer_public_jobs_by_farmer(uuid) to authenticated, service_role;
