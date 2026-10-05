// 農家 step8: 作業の説明・写真ごとの説明・作業動画。
import { useState } from "react";
import { lfStyles } from "../lfStyles";
import { LFWizCard } from "../../../../components/ui";
import { photoThumb } from "../../../../lib/utils";

const VIDEO_CONSENT_VERSION = "2026-10-05-v1";

function youtubeId(raw) {
  try {
    const u = new URL(String(raw || "").trim());
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") return u.pathname.split("/").filter(Boolean)[0] || "";
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v") || "";
      const m = u.pathname.match(/^\/(?:shorts|embed)\/([^/?#]+)/);
      return m?.[1] || "";
    }
  } catch {}
  return "";
}
const validYoutube = raw => /^[A-Za-z0-9_-]{6,20}$/.test(youtubeId(raw));

function WorkVideoPage({ url, setUrl, jobConsent, setJobConsent, relatedConsent, setRelatedConsent, consentAt, setConsentAt, consentVersion, setConsentVersion, onClose }) {
  const clean = url.trim();
  const valid = !clean || validYoutube(clean);
  const canClose = !clean || (valid && jobConsent);
  const onUrl = value => {
    setUrl(value);
    // URLを変更したら、以前のURLに対する同意を引き継がない。
    setJobConsent(false); setRelatedConsent(false); setConsentAt(null); setConsentVersion(null);
  };
  const acceptJob = checked => {
    setJobConsent(checked);
    if (checked) {
      setConsentAt(new Date().toISOString());
      setConsentVersion(VIDEO_CONSENT_VERSION);
    } else {
      setRelatedConsent(false); setConsentAt(null); setConsentVersion(null);
    }
  };
  return (
    <div style={{ position:"fixed", inset:0, zIndex:650, background:"#fff", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
      <div style={{ maxWidth:560, margin:"0 auto", padding:"calc(22px + env(safe-area-inset-top, 0px)) 20px calc(96px + env(safe-area-inset-bottom, 0px))" }}>
        <button type="button" onClick={canClose ? onClose : undefined} aria-label="作業の説明に戻る"
          style={{ width:40, height:40, borderRadius:"50%", border:"1px solid #E5E5E5", background:"#fff", color:"#222", fontSize:20, cursor:canClose?"pointer":"not-allowed", opacity:canClose?1:.45 }}>←</button>
        <h2 className="f-sans" style={{ ...lfStyles.stepTitle, marginTop:26 }}>作業動画</h2>
        <p className="f-sans" style={lfStyles.subtitle}>働く前に仕事のイメージを伝える動画を追加できます。現在はYouTube動画に対応しています（任意）。</p>
        <LFWizCard>
          <label className="f-sans" htmlFor="work-video-url" style={{ display:"block", fontSize:13, fontWeight:700, color:"#222", marginBottom:8 }}>YouTube URL</label>
          <input id="work-video-url" type="url" inputMode="url" value={url} onChange={e=>onUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            style={{ width:"100%", boxSizing:"border-box", padding:"14px", border:"1px solid "+(valid?"#DDD":"#C62828"), borderRadius:12, fontSize:15, color:"#222", background:"#fff", outline:"none" }} />
          {!valid && <p role="alert" className="f-sans" style={{ fontSize:13, color:"#C62828", lineHeight:1.6, margin:"8px 0 0" }}>YouTubeの動画URLを入力してください。</p>}
          {clean && valid && (
            <div style={{ marginTop:14, aspectRatio:"16 / 9", borderRadius:14, overflow:"hidden", background:"#000" }}>
              <iframe title="作業動画の確認" src={`https://www.youtube-nocookie.com/embed/${youtubeId(clean)}`} style={{ width:"100%", height:"100%", border:0 }} allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
            </div>
          )}
        </LFWizCard>
        {clean && valid && <>
          <LFWizCard>
            <label style={{ display:"flex", alignItems:"flex-start", gap:10, cursor:"pointer" }}>
              <input type="checkbox" checked={jobConsent} onChange={e=>acceptJob(e.target.checked)} style={{ width:20, height:20, marginTop:2, accentColor:"#00A86B", flexShrink:0 }} />
              <span className="f-sans" style={{ fontSize:14, color:"#222", lineHeight:1.7 }}>この動画を、求人詳細・作業説明・画像/動画ギャラリーなど、この求人の中で埋め込み表示することに同意します。また、掲載に必要な権利・許諾を有していることを確認します。<strong style={{ display:"block", color:"#C62828" }}>必須</strong></span>
            </label>
          </LFWizCard>
          <LFWizCard>
            <label style={{ display:"flex", alignItems:"flex-start", gap:10, cursor:jobConsent?"pointer":"not-allowed", opacity:jobConsent?1:.5 }}>
              <input type="checkbox" disabled={!jobConsent} checked={relatedConsent} onChange={e=>setRelatedConsent(e.target.checked)} style={{ width:20, height:20, marginTop:2, accentColor:"#00A86B", flexShrink:0 }} />
              <span className="f-sans" style={{ fontSize:14, color:"#222", lineHeight:1.7 }}>この動画を、Chitose-bank内の他の求人などで、同種の作物・作業を説明する「関連動画」として掲載することにも同意します。<strong style={{ display:"block", color:"#717171" }}>任意</strong></span>
            </label>
          </LFWizCard>
          <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7 }}>関連動画は参考情報として表示し、求人先固有の作業方法とは区別します。動画を削除・非公開にした場合は再生できなくなることがあります。</p>
        </>}
      </div>
      <div style={{ position:"fixed", left:0, right:0, bottom:0, padding:"12px 20px calc(12px + env(safe-area-inset-bottom, 0px))", background:"#fff", borderTop:"1px solid #EBEBEB" }}>
        <button type="button" disabled={!canClose} onClick={canClose ? onClose : undefined} className="btn-primary" style={{ display:"block", width:"100%", maxWidth:520, margin:"0 auto", padding:"14px", borderRadius:12, fontWeight:700, opacity:canClose?1:.5 }}>
          {clean ? "保存して戻る" : "動画なしで戻る"}
        </button>
      </div>
    </div>
  );
}

export function StepDescription({ jobDescription, setJobDescription, jobPhotos, setJobPhotos, selectedPhotoIndex, setSelectedPhotoIndex, photoCaptionsOpen, setPhotoCaptionsOpen, captionTextareaRef,
  workVideoUrl, setWorkVideoUrl, workVideoJobConsent, setWorkVideoJobConsent, workVideoRelatedConsent, setWorkVideoRelatedConsent,
  workVideoConsentAt, setWorkVideoConsentAt, workVideoConsentVersion, setWorkVideoConsentVersion }) {
  const [videoOpen, setVideoOpen] = useState(false);
  return (<>
    <h2 className="f-sans" style={lfStyles.stepTitle}>どんな一日になるか、伝えましょう</h2>
    <p className="f-sans" style={lfStyles.subtitle}>作業の流れや、初めての人に伝えておきたいことを書けます（任意）。</p>
    <div style={{ display:"flex", flexWrap:"wrap", gap:14, margin:"-8px 0 16px" }}>
      {jobPhotos.length > 0 && <button onClick={()=>setPhotoCaptionsOpen(true)} className="f-sans" style={{ background:"none", border:"none", padding:0, fontSize:14, fontWeight:700, color:"#00A86B", textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>写真の説明 →</button>}
      <button type="button" onClick={()=>setVideoOpen(true)} className="f-sans" style={{ background:"none", border:"none", padding:0, fontSize:14, fontWeight:700, color:"#00A86B", textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>
        {workVideoUrl?.trim() ? "作業動画を確認・変更 →" : "作業動画を追加 →"}
      </button>
    </div>
    <LFWizCard>
      <textarea aria-label="作業の説明" value={jobDescription} onChange={e => setJobDescription(e.target.value)}
        placeholder="例：ブロッコリーの収穫と箱詰めをお願いします。畑は平坦で、初めての方でも当日にコツをお教えします。10時と15時に休憩があります。" maxLength={1000}
        style={{ background:"#fff", color:"#222", width:"100%", minHeight:200, padding:"16px", fontSize:15, lineHeight:1.8, border:"1px solid #E5E5E5", borderRadius:14, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }} />
      <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginTop:8, textAlign:"right" }}>{jobDescription.length} / 1000</p>
    </LFWizCard>
    {workVideoUrl?.trim() && workVideoJobConsent && <p className="f-sans" style={{ fontSize:13, color:"#0B6B4F", margin:"10px 0 0" }}>作業動画を追加済み{workVideoRelatedConsent ? "・関連動画への掲載も許可" : ""}</p>}

    {videoOpen && <WorkVideoPage url={workVideoUrl} setUrl={setWorkVideoUrl} jobConsent={workVideoJobConsent} setJobConsent={setWorkVideoJobConsent}
      relatedConsent={workVideoRelatedConsent} setRelatedConsent={setWorkVideoRelatedConsent} consentAt={workVideoConsentAt} setConsentAt={setWorkVideoConsentAt}
      consentVersion={workVideoConsentVersion} setConsentVersion={setWorkVideoConsentVersion} onClose={()=>setVideoOpen(false)} />}

    {photoCaptionsOpen && jobPhotos.length > 0 && (
      <div className="cb-lock-scroll" onClick={()=>setPhotoCaptionsOpen(false)} onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} style={{ position:"fixed", inset:0, zIndex:700, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
        <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}><p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>写真の説明</p></div>
          <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y", padding:16 }}>
            <p className="f-sans" style={{ fontSize:14, color:"#717171", marginBottom:14 }}>写真を横にスワイプして、それぞれに一言添えられます。</p>
            <div onScroll={e => { const w = e.currentTarget.clientWidth; if (w > 0) setSelectedPhotoIndex(Math.max(0, Math.min(jobPhotos.length - 1, Math.round(e.currentTarget.scrollLeft / w)))); }}
              style={{ display:"flex", overflowX:"auto", overflowY:"hidden", scrollSnapType:"x mandatory", borderRadius:14, touchAction:"pan-x pan-y", overscrollBehaviorX:"contain", transform:"translateZ(0)", marginBottom:8 }}>
              {jobPhotos.map((p, i) => <img loading="lazy" key={i} src={photoThumb(p)} alt={`写真${i+1}`} style={{ flexShrink:0, width:"100%", height:200, objectFit:"cover", borderRadius:14, scrollSnapAlign:"start" }} />)}
            </div>
            <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:10 }}>{jobPhotos.map((_, i) => <span key={i} style={{ fontSize:10, color: i === selectedPhotoIndex ? "#00A86B" : "#D0D0D0" }}>{i === selectedPhotoIndex ? "●" : "○"}</span>)}</div>
            <textarea ref={captionTextareaRef} value={jobPhotos[selectedPhotoIndex]?.caption ?? ""} onChange={e => setJobPhotos(prev => prev.map((p, i) => i === selectedPhotoIndex ? { ...p, caption: e.target.value } : p))}
              placeholder="この写真について一言（例：収穫するブロッコリー畑です）" maxLength={100}
              style={{ width:"100%", minHeight:80, padding:"14px", fontSize:14, lineHeight:1.6, background:"#fff", color:"#222", border:"1px solid #E5E5E5", borderRadius:12, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }} />
          </div>
        </div>
      </div>
    )}
  </>);
}
