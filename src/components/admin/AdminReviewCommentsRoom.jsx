// 評価コメントの確認（#/admin/review-comments・管理者専用）。
// ★2026-08-23たきと指示「審査のフローは削除したはず。即時公開だ」により、承認制を廃止した。
//   いまのこの画面は【審査待ちのキュー】ではなく【公開後の確認】＝家の作法（2026-08-14の
//   求人・自由記述と同じ）に揃えた形：コメントは書かれた時点で公開に乗り、運営は後から見て、
//   誹謗中傷など不適切なものだけを非表示にする（＝取り下げの道は残す・規約第8条／通報の受け皿）。
// admin_review_comments が本文と状態だけを返す（当事者名は返さない＝運営の主観・関与を最小化）。
// ★現状の注記：公開自由記述の入力は2026-08-20の裁定で撤去済み＝新しいコメントは入ってこない。
//   ここに並ぶのはそれ以前に書かれた分（本番に1件）。将来また自由記述を設ける時にこの画面が受け皿になる。
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { Dots } from "../ui";
import { AdminNav } from "./AdminNav";

const DIR_LABEL = { farmer_to_worker: "農家 → 働き手", worker_to_farmer: "働き手 → 農家" };

export function AdminReviewCommentsRoom() {
  const [items, setItems] = useState(null); // null=読み込み中 / [{id,comment,direction,status,created_at}]
  const [busy, setBusy] = useState(null); // 処理中のid

  const load = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_review_comments");
      setItems(data && data.ok ? (data.items || []) : []);
    } catch { setItems([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // approve=false＝非表示にする／true＝公開に戻す。一覧からは消さず状態だけ塗り替える
  // （公開後の確認so、片付けたら消える性質のものではない）
  const moderate = async (id, approve) => {
    if (busy) return;
    setBusy(id);
    const { data, error } = await supabase.rpc("moderate_review_comment", { p_review_id: id, p_approve: approve });
    setBusy(null);
    if (error || !(data && data.ok)) { alert("処理に失敗しました" + (error ? "：" + error.message : "")); return; }
    setItems(prev => (prev || []).map(x => x.id === id ? { ...x, status: approve ? "approved" : "rejected" } : x));
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 14px 80px" }}>
      <AdminNav current="review-comments" />
      <p className="f-sans" style={{ fontSize: 12, color: "#717171", lineHeight: 1.7, margin: "0 0 14px" }}>
        評価に書かれたコメントの一覧です。コメントは書かれた時点で公開されます（相手に見えるのは、双方の評価が揃うか完了から3日たった後）。
        不適切なものがあれば、ここで非表示にできます。
      </p>
      {items === null ? (
        <p className="f-sans" style={{ textAlign: "center", color: "#999", fontSize: 13, padding: "40px 0" }}>読み込み中<Dots /></p>
      ) : items.length === 0 ? (
        <p className="f-sans" style={{ textAlign: "center", color: "#999", fontSize: 13, padding: "40px 0" }}>コメントはありません。</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {items.map(it => {
            const hidden = it.status === "rejected";
            return (
              <div key={it.id} className="f-sans" style={{ border: "1px solid #EBEBEB", borderRadius: 12, padding: "14px 16px", background: hidden ? "#FAFAFA" : "#fff" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#555", background: "#F2F2F2", borderRadius: 20, padding: "3px 10px" }}>{DIR_LABEL[it.direction] || it.direction}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: hidden ? "#999" : "#00A86B", background: hidden ? "#EFEFEF" : "#EAF7F1", borderRadius: 20, padding: "3px 10px" }}>{hidden ? "非表示" : "公開中"}</span>
                  <span style={{ fontSize: 11, color: "#B0B0B0" }}>{it.created_at}</span>
                </div>
                <p style={{ margin: "0 0 12px", fontSize: 14, color: hidden ? "#999" : "#222", lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word" }}>{it.comment}</p>
                <button type="button" disabled={busy === it.id} onClick={() => moderate(it.id, hidden)}
                  style={{ width: "100%", padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: busy === it.id ? "default" : "pointer", opacity: busy === it.id ? 0.6 : 1,
                    border: hidden ? "none" : "1px solid #EBEBEB", background: hidden ? "#00A86B" : "#fff", color: hidden ? "#fff" : "#999" }}>
                  {hidden ? "公開に戻す" : "非表示にする"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
