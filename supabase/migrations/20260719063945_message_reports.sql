-- チャットのコメント報告（2026-07-19）：当事者が問題のあるコメントを指定して運営に報告する。
-- 本文は報告時点の凍結コピー（body_snapshot）を保存＝証跡（メッセージ本体は削除・改変不可の履歴保全と両輪）
CREATE TABLE IF NOT EXISTS public.message_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id),
  application_id uuid NOT NULL,
  reporter_id uuid NOT NULL,
  body_snapshot text NOT NULL,
  sender_id_snapshot uuid NOT NULL,
  reason text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.message_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mr reporter select own" ON public.message_reports FOR SELECT
  USING (reporter_id = auth.uid());
CREATE POLICY "mr admin all" ON public.message_reports FOR ALL
  USING (EXISTS (SELECT 1 FROM app_admins a WHERE a.auth_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM app_admins a WHERE a.auth_id = auth.uid()));
-- INSERTはRPC経由のみ（当事者検証＋本文凍結をサーバー側で行うため、直接INSERTのポリシーは作らない）

CREATE OR REPLACE FUNCTION public.report_chat_message(p_message_id uuid, p_reason text, p_detail text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare v_app uuid; v_body text; v_sender uuid;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;
  select m.application_id, m.body, m.sender_id into v_app, v_body, v_sender
    from public.messages m
    join public.applications a on a.id = m.application_id
   where m.id = p_message_id
     and (a.worker_id = auth.uid() or a.farmer_id = auth.uid());
  if v_app is null then return json_build_object('ok', false, 'reason', 'not_party'); end if;
  if coalesce(trim(p_reason), '') = '' then return json_build_object('ok', false, 'reason', 'no_reason'); end if;

  insert into public.message_reports (message_id, application_id, reporter_id, body_snapshot, sender_id_snapshot, reason, detail)
  values (p_message_id, v_app, auth.uid(), v_body, v_sender, trim(p_reason), nullif(trim(coalesce(p_detail,'')), ''));

  begin
    perform public.notify_admins('message_reported', 'チャットのコメント報告：' || trim(p_reason) || '「' || left(v_body, 40) || '」');
  exception when others then null; end;
  return json_build_object('ok', true);
end;
$$;
REVOKE EXECUTE ON FUNCTION public.report_chat_message(uuid, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.report_chat_message(uuid, text, text) TO authenticated;