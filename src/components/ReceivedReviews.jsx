// 受け取った評価（利用規約 第8条・2026-08-07たきと承認）。
// 肯定的な選択項目（trueのみ）＋審査を通った公開コメントだけを表示する。
// 公開判定（双方の評価が揃うか完了から3日）はDB側 reviews_public_badges が担保＝ここは表示のみ。
// 個々の評価者は出さない（誰がどう評価したかは出さない＝推薦・選別の回避）。
// ★審査を感じさせない：作者側にはこの部品を出さない（自分の評価は MyReviewsOfWorker でそのまま見える）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

// 方向ごとの肯定バッジ定義（falseは公開しない＝第8条2）。順序＝表示順
const BADGE_DEFS = {
  farmer_to_worker: [
    { k: "want_again", label: "🌟 また呼びたい" },
    { k: "entrust", label: "安心して任せられた" },
    { k: "on_time", label: "時間どおり" },
    { k: "as_described", label: "説明どおり" },
    { k: "followed_instructions", label: "指示どおり" },
    { k: "completed_work", label: "最後までやり切った" },
  ],
  worker_to_farmer: [
    { k: "want_again", label: "🌟 また働きたい" },
    { k: "as_described", label: "説明どおり" },
    { k: "safety_care", label: "安全に配慮" },
  ],
};

export function ReceivedReviews({ userId, direction }) {
  const [data, setData] = useState(null); // null=読み込み中 / {ok,badges,comments,total} / {ok:false}
  useEffect(() => {
    let cancelled = false;
    setData(null);
    (async () => {
      try {
        const { data: res } = await supabase.rpc("reviews_public_badges", { p_user_id: userId, p_direction: direction });
        if (!cancelled) setData(res && res.ok ? res : { ok: false });
      } catch { if (!cancelled) setData({ ok: false }); }
    })();
    return () => { cancelled = true; };
  }, [userId, direction]);

  const defs = BADGE_DEFS[direction] || [];
  const badges = (data && data.badges) || {};
  const shown = defs.filter(d => (badges[d.k] || 0) > 0);
  const comments = Array.isArray(data && data.comments) ? data.comments : [];
  // 働き手宛＝農家からの評価＝緑／農家宛＝働き手からの評価＝橙（役割色の規約2026-07-22）
  const AC = direction === "farmer_to_worker" ? "#00A86B" : "#F76B1C";

  return (
    <div>
      {/* 見出し「🌟 受け取った評価」は削除（2026-08-07たきと指示・タブ名「評価」が見出しを兼ねる） */}
      {data === null ? (
        <p className="f-sans" style={{ fontSize: 12, color: "#999", padding: "12px 0" }}>読み込み中…</p>
      ) : (shown.length === 0 && comments.length === 0) ? (
        <p className="f-sans" style={{ fontSize: 12, color: "#999", lineHeight: 1.7 }}>
          お互いの評価が揃うか、完了から3日で表示されます。
        </p>
      ) : (
        <>
          {shown.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: comments.length > 0 ? 12 : 0 }}>
              {shown.map(d => (
                <span key={d.k} className="f-sans" style={{ fontSize: 12, fontWeight: 600, color: "#222", background: "#F0F7F4", border: "1px solid #CDE9DD", borderRadius: 20, padding: "4px 11px" }}>
                  {d.label} <b style={{ color: AC }}>{badges[d.k]}</b>
                </span>
              ))}
            </div>
          )}
          {comments.map((c, i) => (
            <div key={i} className="f-sans" style={{ borderTop: i === 0 ? "none" : "1px solid #EEE", padding: i === 0 ? "0 0 6px" : "8px 0 6px" }}>
              <p style={{ margin: 0, fontSize: 13, color: "#222", lineHeight: 1.7, overflowWrap: "break-word", wordBreak: "break-word" }}>{c.comment}</p>
              <p style={{ margin: "2px 0 0", fontSize: 10, color: "#B0B0B0" }}>{c.date}</p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
