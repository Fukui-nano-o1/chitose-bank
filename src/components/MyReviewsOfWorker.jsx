// 分割3-C（2026-07-25）：App.jsxから移動。応募者カード・お気に入り詳細・プレビューシートで共用。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

// あなたの評価（2026-07-19）：この農家自身が過去にこの働き手へ行った評価の全記録。
// 職安法対応：reviewsのRLSは reviewer_id = auth.uid() のSELECTのみ＝評価した当人にしか読めず、
// 他の農家・第三者への評価公開（推薦・選別）はDBレベルで不可能。本人の記録を本人に見せるだけの設計
export function MyReviewsOfWorker({ workerId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { if (!cancelled) setRows([]); return; }
        const { data } = await supabase.from("reviews")
          .select("id,application_id,want_again,entrust,public_comment,private_memo,created_at")
          .eq("reviewer_id", session.user.id).eq("reviewee_id", workerId).eq("direction", "farmer_to_worker")
          .order("created_at", { ascending: false });
        if (!cancelled) setRows(data || []);
      } catch { if (!cancelled) setRows([]); }
    })();
    return () => { cancelled = true; };
  }, [workerId]);
  if (!rows || rows.length === 0) return null;
  const yn = (v) => (v === true ? "はい" : v === false ? "いいえ" : "ー");
  return (
    <div style={{ marginTop:14, background:"#F7FBF9", border:"1px solid #D8EFE3", borderRadius:12, padding:"12px 14px" }}>
      <p className="f-sans" style={{ fontSize:12, fontWeight:800, color:"#00A86B", margin:"0 0 2px" }}>📋 あなたの評価</p>
      <p className="f-sans" style={{ fontSize:10, color:"#999", margin:"0 0 8px" }}>あなたが行った評価の記録です。あなた以外の農家には表示されません</p>
      {rows.map(r => (
        <div key={r.id} className="f-sans" style={{ borderTop:"1px solid #E5F2EB", padding:"8px 0 6px", fontSize:12, color:"#222" }}>
          <p style={{ margin:"0 0 4px", color:"#999", fontSize:11 }}>{new Date(r.created_at).toLocaleDateString("ja-JP")}</p>
          <p style={{ margin:0 }}>また呼びたい：<b>{yn(r.want_again)}</b>　安心して任せられた：<b>{yn(r.entrust)}</b></p>
          {r.public_comment && <p style={{ margin:"4px 0 0", lineHeight:1.6, overflowWrap:"break-word", wordBreak:"break-word" }}>働きぶり：{r.public_comment}</p>}
          {r.private_memo && <p style={{ margin:"4px 0 0", lineHeight:1.6, color:"#717171", overflowWrap:"break-word", wordBreak:"break-word" }}>🔒 メモ（自分のみ）：{r.private_memo}</p>}
        </div>
      ))}
    </div>
  );
}
