-- 委託 準備室（2026-07-19たきと指示）：B2B委託レーンの手動1件（この冬・運営者自身がモデル）用の内部台帳。
-- 市場機能（掲載板・受託者画面・決済）は作らない——手動1件の後に判断。管理者専用（RLS: app_admins のみ）
CREATE TABLE IF NOT EXISTS public.consignment_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spec jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.consignment_deals IS '委託準備室の台帳（仕様書全文をspecにjsonb格納）。状態: draft/agreed/working/inspected/paid/completed';
ALTER TABLE public.consignment_deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cd admin all" ON public.consignment_deals FOR ALL
  USING (EXISTS (SELECT 1 FROM app_admins a WHERE a.auth_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM app_admins a WHERE a.auth_id = auth.uid()));