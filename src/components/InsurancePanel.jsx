// 求人の「保険」タブ本体（2026-07-25）：農家プロの保険準備ページで選んだ項目を、
// 対象求人の詳細ページ・確認ページにカードとして出す。構造はプロフィール入口カード
// （ProfileHub hubBox）と同型＝絵文字＋ラベル＋右上「？」、タップでカードが裏返り
// 運営用意の定型説明（INSURANCE_DESC）＋農家の自由記述メモ（insurance_notes）が中に出る。
// 「これから準備予定(considering)」は未加入で性質が違うため最下段・全幅・淡色。
// 自己申告の注記（緑の説明箱）はカードの下に置く（2026-07-25たきと指示で下へ移植）。
// employer は job_employer_profile RPC（詳細）／本人の employer_profiles 行（確認）どちらの形でも可。
import { useState } from "react";
import { INSURANCE_ITEMS, INSURANCE_DESC, normalizeInsuranceItems } from "../lib/utils";

export function InsurancePanel({ employer }) {
  const [flip, setFlip] = useState(null); // 裏返し中の項目キー（同時に1枚だけ）
  const items = normalizeInsuranceItems(employer?.insurance_items); // 旧データの「considering＋実保険」同居を表示側でも排他
  const notes = (employer && typeof employer.insurance_notes === "object" && employer.insurance_notes) || {};

  if (items.length === 0) {
    return (
      <p className="f-sans" style={{ color:"#999", fontSize:13, padding:"16px 0", textAlign:"center" }}>
        この農家はまだ保険の準備方針を申告していません。
      </p>
    );
  }
  const renderCard = (k, muted) => {
    const it = INSURANCE_ITEMS.find(x => x.k === k);
    if (!it) return null;
    const flipped = flip === k;
    const note = typeof notes[k] === "string" ? notes[k].trim() : "";
    const desc = INSURANCE_DESC[k] || "";
    return (
      <button key={k} onClick={()=>setFlip(flipped ? null : k)} className="f-sans" style={{
        position:"relative", gridColumn: muted ? "1 / -1" : undefined,
        background: muted ? "#FAFAFA" : "#fff", border:"1px solid #EBEBEB", borderRadius:20,
        padding:"26px 8px 18px", cursor:"pointer", display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center", gap:8, boxShadow:"0 2px 12px rgba(0,0,0,0.05)",
        minWidth:0, minHeight:132, boxSizing:"border-box",
      }}>
        <span aria-hidden="true" style={{ position:"absolute", top:8, right:8, width:22, height:22, borderRadius:11, background: flipped ? "#00A86B" : "#F0F0F0", color: flipped ? "#fff" : "#999", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>？</span>
        {flipped ? (
          <span className="pflip-in" style={{ fontSize:12, color:"#555", lineHeight:1.7, textAlign:"center", padding:"2px 8px", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>
            {desc}{note ? "\n\n農家より：" + note : ""}
          </span>
        ) : (<>
          <span style={{ fontSize:44, lineHeight:1 }}>{it.icon}</span>
          <span style={{ fontSize:15, fontWeight:700, color: muted ? "#717171" : "#222", textAlign:"center" }}>{it.chip}</span>
        </>)}
      </button>
    );
  };
  return (
    <div className="f-sans">
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        {items.filter(k => k !== "considering").map(k => renderCard(k, false))}
        {items.includes("considering") && renderCard("considering", true)}
      </div>
      {/* 自己申告の注記（下に移植・2026-07-25たきと指示。質問タブと同じ緑の説明箱） */}
      <div style={{ background:"#F7FBF9", border:"1px solid #DDEDE5", borderRadius:12, padding:"12px 14px", marginTop:14 }}>
        <p style={{ fontSize:13, fontWeight:700, color:"#0B6B4F", margin:"0 0 4px" }}>この農家の保険の準備（自己申告）</p>
        <p style={{ fontSize:12, color:"#5B7B6D", margin:0, lineHeight:1.7 }}>
          農家が備えている（または準備中の）保険です。各カードをタップすると説明が開きます。農家の自己申告であり、運営が確認したものではありません。
        </p>
      </div>
    </div>
  );
}
