-- 終了した応募（見送り・失効・取り消し・完了）へのメッセージ送信をDBで拒否
-- （2026-08-31たきと指示「更新が遅れている時にメッセージを送信すると本当に送信される。絶対にだめ」）
--
-- 何が起きていたか：messages のINSERTポリシー「msg insert party」は当事者かどうか（＋停止中でないこと）
-- しか見ておらず、応募が見送り・失効・取り消し・完了になった後でも、画面の更新が遅れて入力欄が
-- 残っていれば送信が本当に通っていた（フロントの幕 CHAT_CLOSED_NOTE は表示だけ＝壁ではなかった）。
-- 対処＝with_check に「応募が終了していないこと」を追加（UIとDBの二重の壁）。
-- ★止めるのは利用者の直接送信だけ：システムの自動投函（apply_to_job・cancel_application・
--   unpublish_job・confirm_terms 等）は全て SECURITY DEFINER（所有者postgres・messages は
--   FORCE RLS なし＝RLS非適用）なので、取り消し後の「応募を取り消しました。」のような
--   終了後の自動メッセージはこれまでどおり入る。
-- ★遮断する状態はフロントの幕（ChatView CHAT_CLOSED_NOTE）と同じ4つ＝
--   rejected / expired / canceled / completed。片方だけ変えないこと（幕と壁は対）。

alter policy "msg insert party" on public.messages
  with check (
    sender_id = auth.uid()
    and not is_account_moderated(auth.uid())
    and exists (
      select 1 from applications a
      where a.id = messages.application_id
        and (a.worker_id = auth.uid() or a.farmer_id = auth.uid())
        and a.status not in ('rejected','expired','canceled','completed')
    )
  );
