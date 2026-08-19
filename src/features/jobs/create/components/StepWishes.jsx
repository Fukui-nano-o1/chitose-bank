// 農家 step10: 持ち物・注意事項・働き手への希望3トグル（第2次構造改革2026-08-17で LandingFlow.jsx から分離）。
// ★中身は移設前と同一（行頭の字下げだけを詰めた）。表示・保存の仕様は変えていない。
// ★モジュールレベル定義を維持すること（コンポーネント内定義はフォーカス消失バグの原因）。
import { lfStyles } from "../lfStyles";
import { LFWizCard } from "../../../../components/ui";

export function StepWishes({ jobNotes, setJobNotes, jobCautions, setJobCautions, beginnerOk, setBeginnerOk, experiencedPreferred, setExperiencedPreferred, instantApproveRepeat, setInstantApproveRepeat, flagInfoOpen, setFlagInfoOpen }) {
  return (<>
    <h2 className="f-sans" style={lfStyles.stepTitle}>働き手への希望</h2>
    <p className="f-sans" style={lfStyles.subtitle}>持ち物や注意事項、求める経験など、働き手に伝えておきたいことを入力できます。作業に必要な道具や安全への備えは、受け入れる農家側でご用意・ご対応ください。（すべて任意です）</p>
    <LFWizCard>
      <div style={{ marginBottom:14 }}>
        <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>持ち物（任意）</label>
        <textarea value={jobNotes} onChange={e => setJobNotes(e.target.value)} placeholder="例：長靴、軍手、飲み物" className="field f-sans" rows={2} style={{ fontSize:13, resize:"vertical" }} />
      </div>
      <div style={{ marginBottom:14 }}>
        <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>注意事項（任意）</label>
        <textarea value={jobCautions} onChange={e => setJobCautions(e.target.value)} placeholder="例：天候により作業時間が変わることがあります" className="field f-sans" rows={2} style={{ fontSize:13, resize:"vertical" }} />
      </div>
      {/* 必要経験の選択式は撤回（2026-07-18）：初心者大歓迎・経験者優遇・リピート即決の3トグルに整理。jobExpは旧求人の表示用に温存 */}
      <div style={{ marginBottom:10 }}>
        <button type="button" onClick={()=>setBeginnerOk(v=>!v)} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"12px 14px", borderRadius:12, border:"2px solid", borderColor: beginnerOk ? "#00A86B" : "#EBEBEB", background: beginnerOk ? "#E6F7EF" : "#fff", cursor:"pointer" }}>
          <span style={{ display:"block", fontSize:14, fontWeight:700, color: beginnerOk ? "#00A86B" : "#222" }}>🌱 はじめての人も歓迎{beginnerOk ? "　✓" : ""}</span>
          <span style={{ display:"block", fontSize:11, color:"#717171", marginTop:2 }}>求人カードに「🌱初心者大歓迎」バッジが表示されます</span>
        </button>
        <button type="button" onClick={()=>setFlagInfoOpen("beginner")} className="f-sans" style={{ background:"none", border:"none", padding:"4px 2px 0", fontSize:12, color:"#00A86B", textDecoration:"underline", cursor:"pointer" }}>初心者大歓迎とは？</button>
      </div>
      <div style={{ marginBottom:10 }}>
        <button type="button" onClick={()=>setExperiencedPreferred(v=>!v)} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"12px 14px", borderRadius:12, border:"2px solid", borderColor: experiencedPreferred ? "#1A56C5" : "#EBEBEB", background: experiencedPreferred ? "#E8F0FE" : "#fff", cursor:"pointer" }}>
          <span style={{ display:"block", fontSize:14, fontWeight:700, color: experiencedPreferred ? "#1A56C5" : "#222" }}>💪 経験者優遇{experiencedPreferred ? "　✓" : ""}</span>
          <span style={{ display:"block", fontSize:11, color:"#717171", marginTop:2 }}>求人カードに「💪経験者優遇」バッジが表示されます</span>
        </button>
        <button type="button" onClick={()=>setFlagInfoOpen("expert")} className="f-sans" style={{ background:"none", border:"none", padding:"4px 2px 0", fontSize:12, color:"#1A56C5", textDecoration:"underline", cursor:"pointer" }}>経験者優遇とは？</button>
      </div>
      <div>
        <button type="button" onClick={()=>setInstantApproveRepeat(v=>!v)} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"12px 14px", borderRadius:12, border:"2px solid", borderColor: instantApproveRepeat ? "#D9A013" : "#EBEBEB", background: instantApproveRepeat ? "#FFF8E7" : "#fff", cursor:"pointer" }}>
          <span style={{ display:"block", fontSize:14, fontWeight:700, color: instantApproveRepeat ? "#8A6D1D" : "#222" }}>🌟 また呼びたい即決{instantApproveRepeat ? "　✓" : ""}</span>
          <span style={{ display:"block", fontSize:11, color:"#717171", marginTop:2 }}>あなたがお気に入り登録（また呼びたい）した方の応募だけ、自動で承認されます（採用ではありません）</span>
        </button>
        <button type="button" onClick={()=>setFlagInfoOpen("repeat")} className="f-sans" style={{ background:"none", border:"none", padding:"4px 2px 0", fontSize:12, color:"#8A6D1D", textDecoration:"underline", cursor:"pointer" }}>リピート即決とは？</button>
      </div>
    </LFWizCard>

    {/* 「〇〇とは？」説明ボックス（2026-07-18）：タップで展開・✕/背景で閉じる。フロー横スワイプに拾われないようタッチを遮断 */}
    {flagInfoOpen && (() => {
      const info = flagInfoOpen === "beginner"
        ? { icon:"🌱", title:"初心者大歓迎とは？", body:"農業がはじめての人も歓迎する求人であることを示すマークです。ONにすると、求人カードと詳細ページに「🌱初心者大歓迎」バッジが表示され、経験のない方も応募しやすくなります。承認するかどうかの判断は、これまで通りあなたが行います。" }
        : flagInfoOpen === "expert"
        ? { icon:"💪", title:"経験者優遇とは？", body:"農作業の経験がある方を優先したいことを示すマークです。ONにすると、求人カードと詳細ページに「💪経験者優遇」バッジが表示され、経験のある方が応募しやすくなります。経験の浅い方の応募を妨げるものではなく、承認の判断はこれまで通りあなたが行います。" }
        : { icon:"🌟", title:"リピート即決とは？", body:"一緒に働いたあと、あなたが「また呼びたい」と評価してお気に入り登録した方が、この求人に応募したときだけ、自動的に承認される仕組みです（承認は採用ではありません。採用は打ち合わせ・面接のあとに、あなたが「採用する」で決めます）。登録していない方の応募は、これまで通りあなたが判断します。効果はあなた自身の求人だけに働き、ほかの農家の求人には影響しません。" };
      return (
        <div onClick={()=>setFlagInfoOpen(null)}
          onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()}
          style={{ position:"fixed", inset:0, zIndex:8000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease", display:"flex", alignItems:"center", justifyContent:"center", padding:"24px 12px" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"relative", width:"100%", maxWidth:480, background:"#fff", borderRadius:20, padding:"28px 24px 24px", boxShadow:"0 12px 48px rgba(0,0,0,0.25)" }}>
            <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 12px" }}>{info.icon} {info.title}</p>
            <p className="f-sans" style={{ fontSize:14, color:"#444", lineHeight:1.9, margin:0 }}>{info.body}</p>
          </div>
        </div>
      );
    })()}
  </>);
}
