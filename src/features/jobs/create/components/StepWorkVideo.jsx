import { lfStyles } from "../lfStyles";
import { LFWizCard } from "../../../../components/ui";

export const WORK_VIDEO_CONSENT_VERSION = "2026-10-05-v1";

export function youtubeVideoId(raw) {
  try {
    const u = new URL(String(raw || "").trim());
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") return u.pathname.split("/").filter(Boolean)[0] || "";
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v") || "";
      return u.pathname.match(/^\/(?:shorts|embed)\/([^/?#]+)/)?.[1] || "";
    }
  } catch {}
  return "";
}
export const isValidYoutubeVideo = raw => /^[A-Za-z0-9_-]{6,20}$/.test(youtubeVideoId(raw));

export function StepWorkVideo({ url, setUrl, jobConsent, setJobConsent, relatedConsent, setRelatedConsent, setConsentAt, setConsentVersion, compact = false }) {
  const clean = url.trim();
  const valid = !clean || isValidYoutubeVideo(clean);
  const onUrl = value => {
    setUrl(value);
    setJobConsent(false); setRelatedConsent(false); setConsentAt(null); setConsentVersion(null);
  };
  const onJobConsent = checked => {
    setJobConsent(checked);
    if (checked) {
      setConsentAt(new Date().toISOString());
      setConsentVersion(WORK_VIDEO_CONSENT_VERSION);
    } else {
      setRelatedConsent(false); setConsentAt(null); setConsentVersion(null);
    }
  };
  return (<>
    {!compact && <h2 className="f-sans" style={lfStyles.stepTitle}>作業動画を追加しますか？</h2>}
    {!compact && <p className="f-sans" style={lfStyles.subtitle}>働き手が仕事をイメージできる動画を追加できます。YouTube動画に対応しています（任意）。</p>}
    <LFWizCard>
      <label className="f-sans" htmlFor="work-video-url" style={{ display:"block", fontSize:13, fontWeight:700, color:"#222", marginBottom:8 }}>YouTube URL</label>
      <input id="work-video-url" type="url" inputMode="url" value={url} onChange={e=>onUrl(e.target.value)}
        placeholder="https://www.youtube.com/watch?v=..."
        style={{ width:"100%", boxSizing:"border-box", padding:"14px", border:"1px solid "+(valid?"#DDD":"#C62828"), borderRadius:12, fontSize:15, color:"#222", background:"#fff", outline:"none" }} />
      {!valid && <p role="alert" className="f-sans" style={{ fontSize:13, color:"#C62828", lineHeight:1.6, margin:"8px 0 0" }}>YouTubeの動画URLを入力してください。</p>}
      {clean && valid && <div style={{ marginTop:14, aspectRatio:"16 / 9", borderRadius:14, overflow:"hidden", background:"#000" }}>
        <iframe title="作業動画の確認" src={`https://www.youtube-nocookie.com/embed/${youtubeVideoId(clean)}`} style={{ width:"100%", height:"100%", border:0 }} allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
      </div>}
    </LFWizCard>
    {clean && valid && <>
      <LFWizCard>
        <label style={{ display:"flex", alignItems:"flex-start", gap:10, cursor:"pointer" }}>
          <input type="checkbox" checked={jobConsent} onChange={e=>onJobConsent(e.target.checked)} style={{ width:20, height:20, marginTop:2, accentColor:"#00A86B", flexShrink:0 }} />
          <span className="f-sans" style={{ fontSize:14, color:"#222", lineHeight:1.7 }}>この動画を、求人詳細・作業説明・画像/動画ギャラリーなど、この求人の中で埋め込み表示することに同意します。また、掲載に必要な権利・許諾を有していることを確認します。<strong style={{ display:"block", color:"#C62828" }}>動画を追加する場合は必須</strong></span>
        </label>
      </LFWizCard>
      <LFWizCard>
        <label style={{ display:"flex", alignItems:"flex-start", gap:10, cursor:jobConsent?"pointer":"not-allowed", opacity:jobConsent?1:.5 }}>
          <input type="checkbox" disabled={!jobConsent} checked={relatedConsent} onChange={e=>setRelatedConsent(e.target.checked)} style={{ width:20, height:20, marginTop:2, accentColor:"#00A86B", flexShrink:0 }} />
          <span className="f-sans" style={{ fontSize:14, color:"#222", lineHeight:1.7 }}>この動画を、Chitose-bank内の他の求人などで、同種の作物・作業を説明する「関連動画」として掲載することにも同意します。<strong style={{ display:"block", color:"#717171" }}>任意</strong></span>
        </label>
      </LFWizCard>
      <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7 }}>関連動画は参考情報として表示し、求人先固有の作業方法とは区別します。</p>
    </>}
  </>);
}
