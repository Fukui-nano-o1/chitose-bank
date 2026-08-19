// 農家 step8: 作業の説明・写真ごとの説明（第2次構造改革2026-08-17で LandingFlow.jsx から分離）。
// ★中身は移設前と同一（行頭の字下げだけを詰めた）。表示・保存の仕様は変えていない。
// ★モジュールレベル定義を維持すること（コンポーネント内定義はフォーカス消失バグの原因）。
import { lfStyles } from "../lfStyles";
import { LFWizCard } from "../../../../components/ui";
import { photoThumb } from "../../../../lib/utils";

export function StepDescription({ jobDescription, setJobDescription, jobPhotos, setJobPhotos, selectedPhotoIndex, setSelectedPhotoIndex, photoCaptionsOpen, setPhotoCaptionsOpen, captionTextareaRef }) {
  return (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>作業の説明</h2>
            <p className="f-sans" style={lfStyles.subtitle}>どんな作業をするか、自由に書けます。空欄のままでも、作業内容に応じた説明が自動で入ります。思いつくことから書いてみましょう。</p>
            {jobPhotos.length > 0 && (
              <button onClick={()=>setPhotoCaptionsOpen(true)} className="f-sans" style={{ display:"inline-flex", alignItems:"center", gap:6, background:"none", border:"none", padding:0, margin:"-8px 0 16px", fontSize:14, fontWeight:700, color:"#00A86B", textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>
                写真の説明 →
              </button>
            )}
            <LFWizCard>
              <textarea
                value={jobDescription}
                onChange={e => setJobDescription(e.target.value)}
                placeholder="例：ブロッコリーの収穫と箱詰めをお願いします。畑は平坦で、初めての方でも当日にコツをお教えします。10時と15時に休憩があります。"
                maxLength={1000}
                style={{ background:"#fff", color:"#222", width:"100%", minHeight:200, padding:"16px", fontSize:15, lineHeight:1.8, border:"1px solid #E5E5E5", borderRadius:14, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }}
              />
              <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginTop:8, textAlign:"right" }}>{jobDescription.length} / 1000</p>
            </LFWizCard>

    {/* 写真ごとの説明はポップアップに移設（2026-07-16）：「写真ごとに説明→🔗」タップで展開・0.8秒 */}
    {photoCaptionsOpen && jobPhotos.length > 0 && (
      <div onClick={()=>setPhotoCaptionsOpen(false)} onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} style={{ position:"fixed", inset:0, zIndex:700, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>{/* タッチ遮断=写真スワイプがフローの画面遷移にならない（2026-07-16） */}
        <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
            <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>写真の説明</p>
          </div>
          <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y", padding:16 }}>
            <p className="f-sans" style={{ fontSize:14, color:"#717171", marginBottom:14 }}>写真を横にスワイプして、それぞれに一言添えられます。</p>
            {/* サムネイル選択→横スワイプ切替に変更（2026-07-16）。表示中の写真のキャプションを下で編集 */}
            <div onScroll={e => { const w = e.currentTarget.clientWidth; if (w > 0) setSelectedPhotoIndex(Math.max(0, Math.min(jobPhotos.length - 1, Math.round(e.currentTarget.scrollLeft / w)))); }}
              style={{ display:"flex", overflowX:"auto", overflowY:"hidden", scrollSnapType:"x mandatory", borderRadius:14, touchAction:"pan-x pan-y", overscrollBehaviorX:"contain", transform:"translateZ(0)", marginBottom:8 }}>
              {jobPhotos.map((p, i) => (
                <img loading="lazy" key={i} src={photoThumb(p)} alt={`写真${i+1}`} style={{ flexShrink:0, width:"100%", height:200, objectFit:"cover", borderRadius:14, scrollSnapAlign:"start" }} />
              ))}
            </div>
            <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:10 }}>
              {jobPhotos.map((_, i) => (
                <span key={i} style={{ fontSize:10, color: i === selectedPhotoIndex ? "#00A86B" : "#D0D0D0" }}>{i === selectedPhotoIndex ? "●" : "○"}</span>
              ))}
            </div>
            <textarea
              ref={captionTextareaRef}
              value={jobPhotos[selectedPhotoIndex]?.caption ?? ""}
              onChange={e => setJobPhotos(prev => prev.map((p, i) => i === selectedPhotoIndex ? { ...p, caption: e.target.value } : p))}
              placeholder="この写真について一言（例：収穫するブロッコリー畑です）"
              maxLength={100}
              style={{ width:"100%", minHeight:80, padding:"14px", fontSize:14, lineHeight:1.6, background:"#fff", color:"#222", border:"1px solid #E5E5E5", borderRadius:12, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }}
            />
          </div>
        </div>
      </div>
    )}

  </>);
}
