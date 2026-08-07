// 評価コメントの審査（#/admin/review-comments・管理者専用・2026-08-07たきと承認）。
// 目的：公開コメント（良心的なもの）を承認して初めて公開に乗せる。運営だけが見る＝作者は審査を感じない。
// admin_pending_review_comments が本文だけを返す（当事者名は返さない＝運営の主観・関与を最小化）。
// 選択項目のバッジは審査不要で即公開so、ここではコメントだけを扱う。
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { Dots } from "../ui";
import { AdminNav } from "./AdminNav";

const DIR_LABEL = { farmer_to_worker: "農家 → 働き手", worker_to_farmer: "働き手 → 農家" };

export function AdminReviewCommentsRoom() {
  const [items, setItems] = useState(null); // null=読み込み中 / [] / [{id,comment,direction,created_at}]
  const [busy, setBusy] = useState(null); // 処理中のid

  const load = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_pending_review_comments");
      setItems(data && data.ok ? (data.items || []) : []);
    } catch { setItems([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const moderate = async (id, approve) => {
    if (busy) return;
    setBusy(id);
    const { data, error } = await supabase.rpc("moderate_review_comment", { p_review_id: id, p_approve: approve });
    setBusy(null);
    if (error || !(data && data.ok)) { alert("処理に失敗しました" + (error ? "：" + error.message : "")); return; }
    setItems(prev => (prev || []).filter(x => x.id !== id)); // 片付いたら一覧から外す
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 14px 80px" }}>
      <AdminNav current="review-comments" />
      <p className="f-sans" style={{ fontSize: 12, color: "#717171", lineHeight: 1.7, margin: "0 0 14px" }}>
        公開コメントの審査です。承認したコメントだけが、双方の評価が揃うか完了から3日たった後に相手に表示されます。
        選択項目（また呼びたい等）は審査不要で公開されます。
      </p>
      {items === null ? (
        <p className="f-sans" style={{ textAlign: "center", color: "#999", fontSize: 13, padding: "40px 0" }}>読み込み中<Dots /></p>
      ) : items.length === 0 ? (
        <p className="f-sans" style={{ textAlign: "center", color: "#999", fontSize: 13, padding: "40px 0" }}>審査待ちのコメントはありません。</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {items.map(it => (
            <div key={it.id} className="f-sans" style={{ border: "1px solid #EBEBEB", borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#555", background: "#F2F2F2", borderRadius: 20, padding: "3px 10px" }}>{DIR_LABEL[it.direction] || it.direction}</span>
                <span style={{ fontSize: 11, color: "#B0B0B0" }}>{it.created_at}</span>
              </div>
              <p style={{ margin: "0 0 12px", fontSize: 14, color: "#222", lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word" }}>{it.comment}</p>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" disabled={busy === it.id} onClick={() => moderate(it.id, true)}
                  style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", background: "#00A86B", color: "#fff", fontSize: 13, fontWeight: 700, cursor: busy === it.id ? "default" : "pointer", opacity: busy === it.id ? 0.6 : 1 }}>
                  承認して公開
                </button>
                <button type="button" disabled={busy === it.id} onClick={() => moderate(it.id, false)}
                  style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "1px solid #EBEBEB", background: "#fff", color: "#999", fontSize: 13, fontWeight: 700, cursor: busy === it.id ? "default" : "pointer" }}>
                  非公開にする
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
