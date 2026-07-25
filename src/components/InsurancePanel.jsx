// 求人の「🛡保険」タブ本体（2026-07-25）：農家プロの保険準備ページで選んだ項目を、
// 対象求人の詳細ページ・確認ページにタブとして出す。各項目をタップすると、運営用意の定型説明
// （INSURANCE_DESC）＋農家の自由記述メモ（employer_profiles.insurance_notes）が展開する。
// employer は job_employer_profile RPC（詳細）／本人の employer_profiles 行（確認）どちらの形でも可。
import { useState } from "react";
import { INSURANCE_ITEMS, INSURANCE_DESC } from "../lib/utils";

export function InsurancePanel({ employer }) {
  const [open, setOpen] = useState({}); // { key: true }
  const items = Array.isArray(employer?.insurance_items) ? employer.insurance_items : [];
  const notes = (employer && typeof employer.insurance_notes === "object" && employer.insurance_notes) || {};

  if (items.length === 0) {
    return (
      <p className="f-sans" style={{ color:"#999", fontSize:13, padding:"16px 0", textAlign:"center" }}>
        この農家はまだ保険の準備方針を申告していません。
      </p>
    );
  }
  return (
    <div className="f-sans">
      {/* 仕組みの説明（タブを開いた時に先に伝える。質問タブと同じ緑の説明箱に合わせる） */}
      <div style={{ background:"#F7FBF9", border:"1px solid #DDEDE5", borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
        <p style={{ fontSize:13, fontWeight:700, color:"#0B6B4F", margin:"0 0 4px" }}>🛡 この農家の保険の準備（自己申告）</p>
        <p style={{ fontSize:12, color:"#5B7B6D", margin:0, lineHeight:1.7 }}>
          農家が備えている（または準備中の）保険です。各項目をタップすると説明が開きます。農家の自己申告であり、運営が確認したものではありません。
        </p>
      </div>
      <div style={{ borderTop:"1px solid #EEE" }}>
        {items.map(k => {
          const it = INSURANCE_ITEMS.find(x => x.k === k);
          if (!it) return null;
          const isOpen = !!open[k];
          const note = typeof notes[k] === "string" ? notes[k].trim() : "";
          const desc = INSURANCE_DESC[k] || "";
          return (
            <div key={k} style={{ borderBottom:"1px solid #EEE" }}>
              <button
                onClick={()=>setOpen(p => ({ ...p, [k]: !p[k] }))}
                aria-expanded={isOpen}
                className="f-sans"
                style={{ width:"100%", background:"none", border:"none", padding:"14px 2px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, cursor:"pointer", textAlign:"left" }}
              >
                <span style={{ display:"inline-flex", alignItems:"center", gap:8, minWidth:0 }}>
                  <span style={{ fontSize:14, fontWeight:700, color:"#0B6B4F" }}>🛡 {it.chip}</span>
                </span>
                <span style={{ flexShrink:0, fontSize:12, color:"#B0B0B0", transform: isOpen ? "rotate(180deg)" : "none", transition:"transform .15s" }}>▾</span>
              </button>
              {isOpen && (
                <div style={{ padding:"0 2px 14px" }}>
                  {desc && (
                    <p style={{ fontSize:13, color:"#555", lineHeight:1.8, margin:"0 0 8px" }}>{desc}</p>
                  )}
                  {note && (
                    <div style={{ background:"#F6F7F6", borderRadius:10, padding:"10px 12px" }}>
                      <p style={{ fontSize:11, fontWeight:700, color:"#8A8A8A", margin:"0 0 4px" }}>農家からのひとこと</p>
                      <p style={{ fontSize:13, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{note}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
