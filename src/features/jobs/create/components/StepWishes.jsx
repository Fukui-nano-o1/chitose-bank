// 稼働中の希望入力。旧UIは features/jobs/retiredFlags/LegacyStepWishes.jsx に保存。
// 入力値と保存互換性は親が保持し、この部品は現行の入力項目だけを表示する。
import { lfStyles } from "../lfStyles";
import { LFWizCard } from "../../../../components/ui";
import { NavIconInline } from "../../../../components/NavIcons";
import { BelongingTagPicker } from "../../../../components/BelongingTags";

export function StepWishes({ jobNotes, setJobNotes, jobCautions, setJobCautions, experiencedPreferred, setExperiencedPreferred, flagInfoOpen, setFlagInfoOpen, mode = "all" }) {
  return (<>
    <h2 className="f-sans" style={lfStyles.stepTitle}>{({belongings:"持ち物",cautions:"注意事項",preferences:"経験に関する希望"})[mode] || "働き手への希望"}</h2>
    {/* 「安全への備えは農家側で」は促しトーン（2026-07-01の記録どおり法的規定ではない）＝50字制限内で残す */}
    <p className="f-sans" style={lfStyles.subtitle}>持ち物や注意など、働き手へ伝えたいことを入力できます（任意）。安全への備えは農家側でご用意ください。</p>
    <LFWizCard>
      {(mode === "all" || mode === "belongings") && <div style={{ marginBottom:14 }}>
        <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>持ち物（任意・タップで選ぶ）</label>
        {/* タグ選択式（2026-08-28たきと指示「持ち物はタグにしよう。自由記述は極力避けよう」）。
            値は従来どおり jobNotes（belongings文字列）＝保存・下書き・表示は無改修で互換 */}
        <BelongingTagPicker value={jobNotes} onChange={setJobNotes} />
      </div>}
      {(mode === "all" || mode === "cautions") && <div style={{ marginBottom:14 }}>
        <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>注意事項（任意）</label>
        <textarea value={jobCautions} onChange={e => setJobCautions(e.target.value)} placeholder="例：天候により作業時間が変わることがあります" className="field f-sans" rows={2} style={{ fontSize:13, resize:"vertical" }} />
      </div>}
      {(mode === "all" || mode === "preferences") && <div style={{ marginBottom:10 }}>
        <button type="button" onClick={()=>setExperiencedPreferred(v=>!v)} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"12px 14px", borderRadius:12, border:"2px solid", borderColor: experiencedPreferred ? "#1A56C5" : "#EBEBEB", background: experiencedPreferred ? "#E8F0FE" : "#fff", cursor:"pointer" }}>
          <span style={{ display:"block", fontSize:14, fontWeight:700, color: experiencedPreferred ? "#1A56C5" : "#222" }}><NavIconInline name="medal" size={14} style={{ verticalAlign:"-2.5px" }} />経験者優遇{experiencedPreferred ? <NavIconInline name="tick" size={13} style={{ verticalAlign:"-2px", marginLeft:6, marginRight:0 }} /> : ""}</span>
          <span style={{ display:"block", fontSize:11, color:"#717171", marginTop:2 }}>求人カードに「経験者優遇」バッジが表示されます</span>
        </button>
        <button type="button" onClick={()=>setFlagInfoOpen("expert")} className="f-sans" style={{ background:"none", border:"none", padding:"4px 2px 0", fontSize:12, color:"#1A56C5", textDecoration:"underline", cursor:"pointer" }}>経験者優遇とは？</button>
      </div>}
    </LFWizCard>

    {/* 「〇〇とは？」説明ボックス（2026-07-18）：タップで展開・✕/背景で閉じる。フロー横スワイプに拾われないようタッチを遮断 */}
    {flagInfoOpen === "expert" && (() => {
      const info = { iconName:"medal", title:"経験者優遇とは？", body:"農作業の経験がある方を優先したいことを示すマークです。ONにすると、求人カードと詳細ページに「経験者優遇」バッジが表示され、経験のある方が応募しやすくなります。経験の浅い方の応募を妨げるものではなく、承認の判断はこれまで通りあなたが行います。" };
      return (
        <div className="cb-lock-scroll" onClick={()=>setFlagInfoOpen(null)}
          onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()}
          style={{ position:"fixed", inset:0, zIndex:8000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease", display:"flex", alignItems:"center", justifyContent:"center", padding:"24px 12px" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"relative", width:"100%", maxWidth:480, background:"#fff", borderRadius:20, padding:"28px 24px 24px", boxShadow:"0 12px 48px rgba(0,0,0,0.25)" }}>
            <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 12px" }}><NavIconInline name={info.iconName} size={16} style={{ verticalAlign:"-2.5px" }} />{info.title}</p>
            <p className="f-sans" style={{ fontSize:14, color:"#444", lineHeight:1.9, margin:0 }}>{info.body}</p>
          </div>
        </div>
      );
    })()}
  </>);
}
