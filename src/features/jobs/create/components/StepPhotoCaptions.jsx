// 第4弾: 写真の説明を独立ページ化。既存 photos 配列の caption のみ更新する。
import { useState } from "react";
import { lfStyles } from "../lfStyles";
import { photoThumb } from "../../../../lib/utils";

export function StepPhotoCaptions({ jobPhotos, setJobPhotos }) {
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, Math.max(0, jobPhotos.length - 1));
  const photo = jobPhotos[safeIndex];
  if (!photo) return <p className="f-sans">写真がありません。前のページで写真を追加してください。</p>;
  return (<>
    <h2 className="f-sans" style={lfStyles.stepTitle}>写真の説明を追加しましょう</h2>
    <p className="f-sans" style={lfStyles.subtitle}>写真ごとに説明できます（任意）。説明を変更しても写真は削除されません。</p>
    <div style={{maxWidth:560,margin:"0 auto",minWidth:0}}>
      <img src={photoThumb(photo)} alt={`写真${safeIndex+1}`} style={{display:"block",width:"100%",aspectRatio:"4 / 3",objectFit:"cover",borderRadius:16}} />
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,margin:"16px 0"}}>
        <button type="button" disabled={safeIndex===0} onClick={()=>setIndex(i=>Math.max(0,i-1))} className="listing-back">前の写真</button>
        <span className="f-sans" aria-live="polite">{safeIndex+1} / {jobPhotos.length}</span>
        <button type="button" disabled={safeIndex===jobPhotos.length-1} onClick={()=>setIndex(i=>Math.min(jobPhotos.length-1,i+1))} className="listing-back">次の写真</button>
      </div>
      <label className="f-sans" htmlFor="listing-photo-caption" style={{display:"block",fontWeight:700,marginBottom:8}}>この写真の説明</label>
      <textarea id="listing-photo-caption" value={photo.caption || ""} maxLength={100} onChange={e=>setJobPhotos(prev=>prev.map((p,i)=>i===safeIndex?{...p,caption:e.target.value}:p))}
        placeholder="例：ブロッコリーを収穫する畑です" style={{display:"block",width:"100%",minHeight:120,boxSizing:"border-box",padding:16,fontSize:16,border:"1px solid #B0B0B0",borderRadius:12,resize:"vertical"}} />
      <p style={{textAlign:"right",color:"#717171",fontSize:13}}>{(photo.caption || "").length} / 100</p>
    </div>
  </>);
}
