// 掲載祝祭のあとの選択カード（2026-08-07たきと指示「アニメーション終了後、60秒間静止。
// 掲載した求人を見る／一覧に戻る を表示」）。背景は暗くせず静止＝ページの上に浮かぶカード1枚。
// 60秒たったら黙って消える（本番では同時に走る60秒アイドル見張りthaがさがすへ送る・操作すればどちらも止まる）。
// preview＝アニメーションページの再生用：見た目は実物のまま、ボタンはページ遷移せず閉じるだけ
import { useEffect, useRef } from "react";

export function PublishChoiceCard({ jobNumber, onClose, preview = false }) {
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => {
    const t = setTimeout(() => onCloseRef.current?.(), 60 * 1000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="cb-sheet-up" style={{ position:"fixed", left:24, right:24, bottom:"calc(64px + 24px + env(safe-area-inset-bottom, 0px))", zIndex:11000, maxWidth:360, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.28)", padding:"18px 16px" }}>
      <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:"0 0 12px", textAlign:"center" }}>掲載が完了しました</p>
      {jobNumber && (
        <button onClick={()=>{ onCloseRef.current?.(); if (!preview) window.location.hash = "/work/job/" + jobNumber; }} className="f-sans"
          style={{ width:"100%", padding:"14px", fontSize:15, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:12, cursor:"pointer", marginBottom:8 }}>掲載した求人を見る</button>
      )}
      <button onClick={()=>{ onCloseRef.current?.(); if (!preview) window.location.hash = "/profile/employer/active"; }} className="f-sans"
        style={{ width:"100%", padding:"14px", fontSize:15, fontWeight:600, background:"#fff", color:"#555", border:"1px solid #EBEBEB", borderRadius:12, cursor:"pointer" }}>一覧に戻る</button>
    </div>
  );
}
