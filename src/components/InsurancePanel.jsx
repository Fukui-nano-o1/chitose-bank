// 求人の「保険」タブ本体（2026-07-25）：農家プロの保険準備ページで選んだ項目を、
// 対象求人の詳細ページ・確認ページにカードとして出す。構造はプロフィール入口カード
// （ProfileHub hubBox）と同型＝絵文字＋ラベル＋右上「？」、タップでカードが裏返り
// 運営用意の定型説明（INSURANCE_DESC）＋農家の自由記述メモ（insurance_notes）が中に出る。
// 「これから準備予定(considering)」は未加入で性質が違うため最下段・全幅・淡色。
// 自己申告の注記（緑の説明箱）はカードの下に置く（2026-07-25たきと指示で下へ移植）。
// employer は job_employer_profile RPC（詳細）／本人の employer_profiles 行（確認）どちらの形でも可。
// swipe（2026-08-19たきと指示）：カレンダーの下に置く形。2列グリッドでなく横一列に並べ、
// 複数枚のときは指連動の横スワイプで送る（useHorizontalDrag）。1枚だけならはみ出さず動かない。
import { useRef, useState } from "react";
import { INSURANCE_ITEMS, INSURANCE_DESC, normalizeInsuranceItems } from "../lib/utils";
import { useHorizontalDrag } from "../lib/hDrag";

export function InsurancePanel({ employer, swipe = false }) {
  const [flip, setFlip] = useState(null); // 裏返し中の項目キー（同時に1枚だけ）
  const rowRef = useRef(null);
  const items = normalizeInsuranceItems(employer?.insurance_items); // 旧データの「considering＋実保険」同居を表示側でも排他
  const notes = (employer && typeof employer.insurance_notes === "object" && employer.insurance_notes) || {};
  // フックは早期returnより前に置く（Rules of Hooks）。swipeでない時は rowRef.current が null で何もしない
  useHorizontalDrag(rowRef, swipe ? items.length : 0);

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
        position:"relative",
        // グリッド（従来）は「準備予定」を最下段に全幅で敷く。横一列（swipe）は幅を揃えて並べる
        ...(swipe
          ? { flex:"0 0 clamp(148px, 42%, 200px)" }
          : { gridColumn: muted ? "1 / -1" : undefined }),
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
      {swipe ? (
        // 横一列（カレンダーの下）。はみ出す枚数のときだけ指連動で送れる（useHorizontalDrag）。
        // carousel-scroll＝PCでは細いスクロールバーが出る＝送れることの合図
        <div ref={rowRef} className="carousel-scroll" style={{
          display:"flex", gap:12, overflowX:"auto",
          WebkitOverflowScrolling:"touch", overscrollBehaviorX:"contain",
          paddingBottom: items.length > 1 ? 4 : 0,
        }}>
          {items.filter(k => k !== "considering").map(k => renderCard(k, false))}
          {items.includes("considering") && renderCard("considering", true)}
        </div>
      ) : (
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        {items.filter(k => k !== "considering").map(k => renderCard(k, false))}
        {items.includes("considering") && renderCard("considering", true)}
      </div>
      )}
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

// カレンダーの下に置く保険の区画（2026-08-19たきと指示「保険カードをカレンダーの下に移植」）。
// 保険タブは廃止＝表示の入口はここ1つ（求人詳細・ボックス版・掲載前の確認ページで同じ形）。
// 申告が無い求人は見出しごと出さない（危険箇所セクションと同じ作法）。
// style＝置く場所ごとの余白を合わせる（地図・カレンダーと同じ高さにする）。
export function JobInsuranceSection({ employer, style }) {
  const items = normalizeInsuranceItems(employer?.insurance_items);
  if (items.length === 0) return null;
  return (
    <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:16, marginBottom:5, boxSizing:"border-box", ...style }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:20 }}>
        <span style={{ fontSize:18 }}>🛡</span>
        <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>保険の準備</h3>
      </div>
      <InsurancePanel employer={employer} swipe />
    </div>
  );
}
