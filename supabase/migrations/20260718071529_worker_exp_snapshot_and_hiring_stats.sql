-- 承認した働き手の経験区分の計測（2026-07-18）：
-- 承認時点の farm_experience（未経験/経験あり・許可7項目の区分）を applications に凍結し、
-- 「この農家は未経験者を◯人採用」などの農家属性表示の材料にする（働き手個人は特定しない集計のみ）
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS worker_exp_snapshot text;
COMMENT ON COLUMN public.applications.worker_exp_snapshot IS '承認時点の働き手の経験区分（worker_profiles.farm_experienceの凍結値）。承認への遷移時にトリガーで自動記録';

-- 承認への遷移（UPDATE）と、リピート即決の承認済みINSERTの両方で刻む（UIに依存しないDB側の壁）
CREATE OR REPLACE FUNCTION public.set_worker_exp_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved')
     AND NEW.worker_exp_snapshot IS NULL THEN
    SELECT COALESCE(NULLIF(trim(wp.farm_experience), ''), '未回答')
      INTO NEW.worker_exp_snapshot
      FROM worker_profiles wp WHERE wp.auth_id = NEW.worker_id;
    IF NEW.worker_exp_snapshot IS NULL THEN NEW.worker_exp_snapshot := '未回答'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_worker_exp_snapshot_ins ON public.applications;
CREATE TRIGGER trg_worker_exp_snapshot_ins BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.set_worker_exp_snapshot();
DROP TRIGGER IF EXISTS trg_worker_exp_snapshot_upd ON public.applications;
CREATE TRIGGER trg_worker_exp_snapshot_upd BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.set_worker_exp_snapshot();

-- 既存の採用済み行（承認以降まで進んだもの）を現在のプロフィール値でバックフィル
UPDATE public.applications a
SET worker_exp_snapshot = COALESCE(NULLIF(trim(wp.farm_experience), ''), '未回答')
FROM worker_profiles wp
WHERE wp.auth_id = a.worker_id
  AND a.worker_exp_snapshot IS NULL
  AND a.status IN ('approved','meeting','interview','contracted','working','completed');

-- 農家の採用実績の集計RPC（個人を出さない件数のみ）：
-- 例「この農家は未経験者を1人採用しています」の材料。表示実装時はこれを呼ぶだけ
CREATE OR REPLACE FUNCTION public.farmer_hiring_stats(p_farmer_id uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'hired_total', count(*),
    'hired_beginner', count(*) FILTER (WHERE worker_exp_snapshot = '未経験'),
    'hired_experienced', count(*) FILTER (WHERE worker_exp_snapshot = '経験あり')
  )
  FROM applications
  WHERE farmer_id = p_farmer_id
    AND status IN ('approved','meeting','interview','contracted','working','completed');
$$;
REVOKE EXECUTE ON FUNCTION public.farmer_hiring_stats(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.farmer_hiring_stats(uuid) TO authenticated;