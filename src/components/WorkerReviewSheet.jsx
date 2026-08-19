// 終了の確認・評価（働き手→農家）の入力シート（2026-08-19新設）。
// ★この形は2箇所から開く：①応募状況ページ（#/profile/worker/approved）②今日ページの「仕事の評価」。
//   同じ入力が枝分かれしないよう、フォームと保存はこの1部品に集約する
//   （項目を足す時・文言を変える時はここだけを直す）。
// 保存するのは reviews の1行だけ（打刻の署名は撃たない・2026-08-18「打刻の全面削除」）。
// DBの壁：trg_reviews_party_consistency（当事者と向きの一致）＋trg_reviews_phase_gate
//   （worker_to_farmer は working 以上）が最後の担保so、画面はその手前の案内に徹する。
// ★モジュールレベル定義を維持すること：親の中で定義すると再レンダーごとに再マウントされ、
//   textarea のフォーカス・入力中の下書きが消える（LandingFlowのフォーカス消失バグと同族）。
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { fbSuccess, fbError } from "../lib/feedback";
import { YesNoPill } from "./ui";

// app＝{ id, farmer_id }（応募のID と 相手＝農家のauth_id）。meId＝自分のauth_id。
// onDone(applicationId)＝保存できた時に親へ知らせる（一覧から消す・祝祭を出すのは親の仕事）。
export function WorkerReviewSheet({ app, meId, onDone, onClose }) {
  const [wantAgain, setWantAgain] = useState(null);
  const [asDescribed, setAsDescribed] = useState(null);
  const [safetyCare, setSafetyCare] = useState(null);
  const [publicComment, setPublicComment] = useState("");
  const [privateMemo, setPrivateMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const ready = wantAgain !== null && asDescribed !== null && safetyCare !== null;
  const submit = async () => {
    if (!app || !ready || submitting) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("reviews").insert({
        application_id: app.id, reviewer_id: meId, reviewee_id: app.farmer_id,
        direction: "worker_to_farmer", want_again: wantAgain, as_described: asDescribed, safety_care: safetyCare,
        public_comment: publicComment.trim() || null, private_memo: privateMemo.trim() || null,
      });
      if (error) { fbError(); alert("評価の保存に失敗しました：" + error.message); setSubmitting(false); return; }
      fbSuccess();
      onDone(app.id);
    } catch { alert("処理に失敗しました。"); }
    setSubmitting(false);
  };
  if (!app) return null;
  return (
    <div className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:16 }}>終了の確認・評価</p>
        <YesNoPill label="また働きたい" value={wantAgain} onChange={setWantAgain} />
        <YesNoPill label="説明のとおりだった" value={asDescribed} onChange={setAsDescribed} />
        <YesNoPill label="安全に配慮されていた" value={safetyCare} onChange={setSafetyCare} />
        <textarea value={publicComment} onChange={e=>setPublicComment(e.target.value)} placeholder="農園について良かった点を一言（公開されます・任意）" rows={3}
          className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginTop:12 }} />
        <textarea value={privateMemo} onChange={e=>setPrivateMemo(e.target.value)} placeholder="自分だけが見えるメモ（任意）" rows={3}
          className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", margin:"8px 0 16px" }} />
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onClose} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
          <button onClick={submit} disabled={submitting || !ready}
            className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity: (submitting || !ready) ? 0.5 : 1 }}>
            {submitting ? "送信中..." : "送信する"}
          </button>
        </div>
      </div>
    </div>
  );
}
