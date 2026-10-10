// 農家 step8: 作業の説明・写真ごとの説明・作業動画。
import { useState } from "react";
import { lfStyles } from "../lfStyles";
import { LFWizCard } from "../../../../components/ui";
import { photoThumb } from "../../../../lib/utils";
import { NavIcon } from "../../../../components/NavIcons";
import { StepWorkVideo } from "./StepWorkVideo";

export function StepDescription({ jobDescription, setJobDescription, jobPhotos, setJobPhotos, selectedPhotoIndex, setSelectedPhotoIndex, photoCaptionsOpen, setPhotoCaptionsOpen, captionTextareaRef, workVideoUrl, setWorkVideoUrl, workVideoJobConsent, setWorkVideoJobConsent, workVideoRelatedConsent, setWorkVideoRelatedConsent, setWorkVideoConsentAt, setWorkVideoConsentVersion }) {
  const [videoPageOpen, setVideoPageOpen] = useState(false);
  return (<>
    <h2 className="f-sans" style={lfStyles.stepTitle}>どんな一日になるか、伝えましょう</h2>
    <p className="f-sans" style={lfStyles.subtitle}>作業の流れや、初めての人に伝えておきたいことを書けます（任意）。</p>
    {jobPhotos.length > 0 && <button type="button" className="listing-workplace-card" aria-expanded={photoCaptionsOpen} onClick={() => setPhotoCaptionsOpen(true)}>
      <NavIcon name="image" size={32} />
      <span className="listing-workplace-copy"><strong>写真の説明</strong><span>{jobPhotos.length}枚の写真に、それぞれ説明を追加できます。</span></span>
      <svg className="listing-workplace-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
    </button>}
    <button type="button" className="listing-workplace-card" aria-expanded={videoPageOpen} onClick={() => setVideoPageOpen(true)}>
      <NavIcon name="image" size={32} />
      <span className="listing-workplace-copy"><strong>YouTube動画</strong><span>{workVideoUrl?.trim() ? "登録済みの動画を確認・編集" : "YouTubeのリンクを追加できます（任意）。"}</span></span>
      <svg className="listing-workplace-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
    </button>
    <LFWizCard>
      <textarea aria-label="作業の説明" value={jobDescription} onChange={e => setJobDescription(e.target.value)}
        placeholder="例：ブロッコリーの収穫と箱詰めをお願いします。畑は平坦で、初めての方でも当日にコツをお教えします。10時と15時に休憩があります。" maxLength={1000}
        style={{ background:"#fff", color:"#222", width:"100%", minHeight:200, padding:"16px", fontSize:15, lineHeight:1.8, border:"1px solid #E5E5E5", borderRadius:14, outline:"none", resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }} />
      <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginTop:8, textAlign:"right" }}>{jobDescription.length} / 1000</p>
    </LFWizCard>

    {videoPageOpen && (
      <div className="listing-caption-page" role="region" aria-label="YouTube動画ページ">
        <header className="listing-caption-header">
          <button type="button" onClick={() => setVideoPageOpen(false)} aria-label="説明ページに戻る">‹ 戻る</button>
          <strong>YouTube動画</strong>
          <span aria-hidden="true" />
        </header>
        <main className="listing-caption-content">
          <StepWorkVideo url={workVideoUrl} setUrl={setWorkVideoUrl} jobConsent={workVideoJobConsent} setJobConsent={setWorkVideoJobConsent} relatedConsent={workVideoRelatedConsent} setRelatedConsent={setWorkVideoRelatedConsent} setConsentAt={setWorkVideoConsentAt} setConsentVersion={setWorkVideoConsentVersion} compact />
        </main>
        <footer className="listing-caption-footer"><button type="button" onClick={() => setVideoPageOpen(false)}>保存して戻る</button></footer>
      </div>
    )}

    {photoCaptionsOpen && jobPhotos.length > 0 && (
      <div className="listing-caption-page" role="region" aria-label="写真の説明ページ">
        <header className="listing-caption-header">
          <button type="button" onClick={() => setPhotoCaptionsOpen(false)} aria-label="説明ページに戻る">‹ 戻る</button>
          <strong>写真の説明</strong>
          <span aria-hidden="true" />
        </header>
        <main className="listing-caption-content">
          <h2>写真ごとに説明を追加</h2>
          <p>写真を横にスワイプして、1枚ずつ説明を入力できます。</p>
          <div className="listing-caption-gallery" onScroll={e => {const w=e.currentTarget.clientWidth;if(w>0)setSelectedPhotoIndex(Math.max(0,Math.min(jobPhotos.length-1,Math.round(e.currentTarget.scrollLeft/w))));}}>
            {jobPhotos.map((photo,i)=><img key={photo.url || i} src={photoThumb(photo)} alt={`写真${i+1}`} loading="lazy" />)}
          </div>
          <p className="listing-caption-counter">{selectedPhotoIndex+1} / {jobPhotos.length}</p>
          <label className="listing-caption-label" htmlFor="listing-caption-input">この写真の説明</label>
          <textarea id="listing-caption-input" ref={captionTextareaRef} value={jobPhotos[selectedPhotoIndex]?.caption ?? ""} onChange={e=>setJobPhotos(prev=>prev.map((photo,i)=>i===selectedPhotoIndex?{...photo,caption:e.target.value}:photo))} placeholder="例：収穫するブロッコリー畑です" maxLength={100} />
          <p className="listing-caption-counter">{(jobPhotos[selectedPhotoIndex]?.caption ?? "").length} / 100文字</p>
        </main>
        <footer className="listing-caption-footer"><button type="button" onClick={()=>setPhotoCaptionsOpen(false)}>保存して戻る</button></footer>
      </div>
    )}
  </>);
}
