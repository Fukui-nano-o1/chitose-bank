// 仮応募の成功ページ（#/apply/pending・第15弾・2026-07-30たきと指示）。
// 応募の意思は預かった。届くのは本人のプロフィールがそろった時＝引き金は本人の操作だけで、
// 運営の自由記述審査は間に立たない（本弾の原則）。
// ★2026-08-07（②ハイブリッド）：仮応募の【新規到着】はこのページを出さずアニメーション
// （祝祭＋トースト＋応募状況へ着地・App.jsxのcb_pendingNewフラグ消費）。このページが出るのは
// 再訪だけ＝応募状況「プロフィールを仕上げる→」・求人詳細の応募ボタン（仮応募あり時）。
// 残り項目のチェックリストと「応募を農家さんに届ける」（昇格）の受け皿としてここは残す。
import { useState, useEffect } from "react";
import { fetchWorkerReady, promotePendingApplications } from "../lib/workerReady";
import { NoticeJumpText, Dots } from "./ui";
import { NavIcon } from "./NavIcons";

export function ApplyPending() {
  const [state, setState] = useState(null); // { ready, missing }
  const [checking, setChecking] = useState(false);
  useEffect(() => { (async () => setState(await fetchWorkerReady()))(); }, []);
  // このページに戻ってきた時（項目を埋めてブラウザバック等）にも、その場で昇格を試す
  const recheck = async () => {
    if (checking) return;
    setChecking(true);
    const n = await promotePendingApplications();
    if (n > 0) {
      try { sessionStorage.setItem("cb_promoted", String(n)); } catch {}
      window.location.hash = "/apply/done";
      return;
    }
    setState(await fetchWorkerReady());
    setChecking(false);
  };
  return (
    <div style={{ minHeight:"70vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", maxWidth:420, margin:"0 auto", padding:"0 20px" }}>
      <div style={{ display:"flex", justifyContent:"center", marginBottom:16, color:"#00A86B" }}><NavIcon name="check" size={56} /></div>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:12 }}><NoticeJumpText text="仮応募をお預かりしました" /></h2>
      <p className="f-sans" style={{ fontSize:16, color:"#717171", lineHeight:1.8, marginBottom:20 }}>
        プロフィールがそろうと、農家さんに応募が届きます。
      </p>
      {state === null ? (
        <p className="f-sans" style={{ fontSize:13, color:"#999", padding:"16px 0" }}>読み込み中<Dots /></p>
      ) : state.missing.length === 0 ? (
        <>
          <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700, marginBottom:16 }}>必須項目はそろっています。</p>
          <button onClick={recheck} disabled={checking} className="btn-primary" style={{ width:"100%", padding:"15px", fontSize:14, borderRadius:12, marginBottom:12 }}>{checking ? <>確認中<Dots /></> : "応募を農家さんに届ける"}</button>
        </>
      ) : (
        <div style={{ width:"100%", textAlign:"left", marginBottom:20 }}>
          <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:"0 0 10px" }}>あと{state.missing.length}項目です（タップで入力できます）</p>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {state.missing.map(it => (
              <button key={it.k} onClick={()=>{ window.location.hash = it.to(); }} className="f-sans"
                style={{ display:"flex", alignItems:"center", gap:10, width:"100%", textAlign:"left", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:"14px 16px", cursor:"pointer" }}>
                <span style={{ fontSize:16, color:"#E24B4A", flexShrink:0 }}>○</span>
                <span style={{ minWidth:0, flex:1 }}>
                  <span style={{ display:"block", fontSize:14, fontWeight:700, color:"#222" }}>{it.label}</span>
                  <span style={{ display:"block", fontSize:11, color:"#B0B0B0", marginTop:2 }}>{it.hint}</span>
                </span>
                <span style={{ color:"#C8C8C8", fontSize:16, flexShrink:0 }}>›</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, marginBottom:20 }}>
        自己紹介文の確認は運営が行いますが、応募はそれを待たずに届きます。
      </p>
      <button onClick={()=>{ window.location.hash="/profile/worker/applying"; }} className="f-sans" style={{ background:"none", border:"none", fontSize:14, fontWeight:700, color:"#00A86B", textDecoration:"underline", cursor:"pointer", marginBottom:16 }}>仮応募の一覧を見る →</button>
      <button onClick={()=>{ window.location.hash="/search"; }} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:600, background:"#fff", color:"#222", border:"1px solid #EBEBEB", borderRadius:12, cursor:"pointer" }}>ほかの仕事を探す</button>
    </div>
  );
}
