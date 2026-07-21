-- チャット履歴の保全（2026-07-19たきと指示・恒久ルール）：
-- 「いかなる理由があってもチャット欄の連絡先（を含むメッセージ）を削除しない。履歴として双方の確認が取れるようにする」
-- ①列レベル権限：クライアントが更新できるのはread_at（既読時刻）のみ。本文・送信者・時刻は書き換え不可
REVOKE UPDATE ON public.messages FROM authenticated, anon;
GRANT UPDATE (read_at) ON public.messages TO authenticated;

-- ②トリガーの壁：RLSを迂回するservice roleにも効く（trg_block_third_party_openと同じ思想の二重の壁）。
--   UPDATE＝read_at以外の変更を拒否／DELETE＝理由を問わず拒否
CREATE OR REPLACE FUNCTION public.messages_history_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'messages are immutable history: delete is not allowed（チャット履歴は削除できません・2026-07-19恒久ルール）';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'messages are immutable history: only read_at may change（本文・送信者・時刻は変更できません）';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_messages_history_lock_upd ON public.messages;
CREATE TRIGGER trg_messages_history_lock_upd BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_history_lock();
DROP TRIGGER IF EXISTS trg_messages_history_lock_del ON public.messages;
CREATE TRIGGER trg_messages_history_lock_del BEFORE DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_history_lock();

COMMENT ON TABLE public.messages IS 'チャットメッセージ。削除・本文改変は不可（トリガーで恒久拒否・2026-07-19たきと指示）。連絡先を含むメッセージも削除しない＝履歴として双方の確認が取れる状態を保つ。既読化(read_at)のみ更新可';