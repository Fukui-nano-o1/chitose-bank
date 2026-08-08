// 求人カード（分割・段階2後半・2026-07-24）：さがす一覧・関連求人・いいね一覧で共用。
import { useState } from "react";
import { payLabel, dateRangeLabel, photoThumb } from "../lib/utils";
import { Avatar, StatusRibbonLeft } from "./ui";
import { CropIcon } from "./CropIcon";

// 求人カード（さがす一覧・関連求人で共通使用。variantでサイズのみ切り替え）
// saved/onToggleSaveを渡すと右上に♡ボタンを表示（未指定なら非表示＝呼び出し元は変更不要）
// variant="wide"（2026-08-07）：関連カードと同じ「写真に情報を重ねる」型を全幅で。
//   ステータスページの展開ボックス等、シート内の求人要約用（要約の顔を独自に作らない＝このカードが唯一のソース）
// onOpen（任意）：渡すと新しいタブでなくその場の遷移をonOpenに任せる（シート内から同一タブで開く用）
export function JobCard({ job, variant, saved, onToggleSave, onOpen }) {
  const isList = variant === "list";
  const isWide = variant === "wide";
  // タップポップ（2026-08-07たきと指示）：タップの瞬間、写真that少し拡大して元に戻る。
  // 発火はonClick（スクロール開始のタッチでは鳴らない）。ハートはstopPropagationでカードに
  // 伝わらないため、ハート側からも同じトリガーを呼ぶ。アニメ終了でclass解除＝次のタップで再生
  const [photoPop, setPhotoPop] = useState(false);
  const popPhoto = () => setPhotoPop(true);
  const photoAnim = photoPop ? { animation: "cbPhotoTapZoom .35s ease" } : {};
  const p0 = job.photos?.[0];
  const topSrc = photoThumb(p0); // カードは軽量サムネ（thumbが無い古い写真は原寸へフォールバック）
  const photoHeight = isList ? 220 : 220;
  // Airbnb風：写真は四隅を丸く（枠なしカード・2026-07-19）
  const photoRadius = 16;
  const cardStyle = isList
    ? { display:"block", width:"100%", padding:0, textAlign:"left", cursor:"pointer", textDecoration:"none", background:"transparent", border:"none", marginBottom:22, position:"relative" }
    : isWide
    ? { display:"block", width:"100%", padding:0, textAlign:"left", cursor:"pointer", textDecoration:"none", background:"transparent", border:"none", position:"relative" }
    : { flexShrink:0, width:"80vw", maxWidth:280, padding:0, textAlign:"left", cursor:"pointer", textDecoration:"none", background:"transparent", position:"relative" };
  return (
    <a
      href={"#/work/job/" + job.id}
      target={onOpen ? undefined : "_blank"}
      rel="noopener noreferrer"
      style={cardStyle}
      onClick={onOpen ? (e) => { e.preventDefault(); popPhoto(); onOpen(); } : popPhoto}
    >
      {typeof onToggleSave === "function" && !(job.filled || job.expired || job.closed) && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); popPhoto(); onToggleSave(job); }}
          aria-label={saved ? "いいねを解除" : "いいね"}
          style={{ position:"absolute", top:10, right:10, zIndex:2, width:44, height:44, borderRadius:"50%",
                   background:"rgba(255,255,255,0.92)", border:"none", cursor:"pointer",
                   display:"flex", alignItems:"center", justifyContent:"center",
                   boxShadow:"0 1px 4px rgba(0,0,0,.18)", fontSize:24,
                   color: saved ? "#E24B4A" : "#717171" }}>
          {/* グリフだけspanに包む＝ぷるんぷるん（cb-like-heart・スクロール連動）のtransformをボタン円に波及させない */}
          <span className="cb-like-heart" style={{ display:"inline-block" }}>{saved ? "♥" : "♡"}</span>
        </button>
      )}
      {/* 新着帯：掲載から3日間・左上・赤帯白文字（2026-07-16）。終了中（満員/期間終了）は出さない */}
      {job.isNew && !(job.filled || job.expired || job.closed) && <StatusRibbonLeft label="新着" color="#E24B4A" />}
      {/* 開始日チップ：写真右下（2026-07-16）。期間ものは「〜」付き。
          関連(related)カードは概要を写真に重ねるため、日付は下部オーバーレイ内に出す（2026-07-23） */}
      {isList && job.dateStartRaw && (
        <span className="f-sans" style={{ position:"absolute", top: photoHeight - 34, right:8, zIndex:2, padding:"4px 10px", borderRadius:20, background:"rgba(255,255,255,0.92)", color:"#222", fontSize:11, fontWeight:700, boxShadow:"0 1px 4px rgba(0,0,0,.18)" }}>
          {dateRangeLabel(job.dateStartRaw)}{job.dateEndRaw && job.dateEndRaw !== job.dateStartRaw ? "〜" : ""}
        </span>
      )}
      {/* 終了帯（2026-07-21）：採用人数を満たした＝募集終了／作業日程が過ぎた＝募集期間終了。
          探すからは除外せず、写真に半透明の帯を掛けて知らせる（充足を優先表示） */}
      {(job.filled || job.expired || job.closed) && (
        <div style={{ position:"absolute", top:0, left:0, right:0, height:photoHeight, borderRadius:photoRadius, background:"rgba(0,0,0,0.34)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1, pointerEvents:"none" }}>
          <span className="f-sans" style={{ background:"rgba(30,30,30,0.88)", color:"#fff", fontSize: isList?14:12, fontWeight:800, letterSpacing:".04em", padding:"7px 18px", borderRadius:8, boxShadow:"0 2px 8px rgba(0,0,0,0.3)" }}>
            {job.filled ? "募集終了（満員）" : job.closed ? "募集終了" : "募集期間終了"}
          </span>
        </div>
      )}
      {topSrc ? (
        <img loading="lazy" src={topSrc} alt="" onAnimationEnd={()=>setPhotoPop(false)} style={{ width:"100%", height:photoHeight, objectFit:"cover", display:"block", borderRadius:photoRadius, ...photoAnim }} />
      ) : (
        /* 写真が無い求人は求人者のアイコンを大きく出す（2026-07-30たきと指示・詳細/確認ページと同じ扱い）。
           アイコン未設定なら Avatar が名前の頭文字の丸を出し、名前も無ければ作物の絵文字に落とす */
        <div onAnimationEnd={()=>setPhotoPop(false)} style={{ width:"100%", height:photoHeight, borderRadius:photoRadius, background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:48, ...photoAnim }}>
          {(job.employerAvatar || job.employerName)
            ? <Avatar url={job.employerAvatar} name={job.employerName || "？"} size={isList ? 112 : 88} />
            : <CropIcon crop={job.crop} size={48} />}
        </div>
      )}
      {/* 概要：list=写真の下／related=写真の上に黒半透明グラデで重ねる（2026-07-23） */}
      <div style={ isList ? { padding:"12px 4px 0" } : {
        position:"absolute", left:0, right:0, bottom:0, zIndex:2, pointerEvents:"none",
        padding:"34px 12px 12px", borderRadius:`0 0 ${photoRadius}px ${photoRadius}px`,
        background:"linear-gradient(to top, rgba(0,0,0,0.82), rgba(0,0,0,0.18) 58%, rgba(0,0,0,0))",
      }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom: isList?4:3 }}>
          <p className="f-sans" style={{ fontSize: isList?17:14, fontWeight: isList?600:700, color: isList?"#222":"#fff", margin:0, flex:"1 1 auto", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textShadow: isList?"none":"0 1px 3px rgba(0,0,0,0.6)" }}>{job.crop} {job.task}</p>
          <span className="f-sans" style={{ fontSize: isList?12:10, color: isList?"#B0B0B0":"rgba(255,255,255,0.88)", flexShrink:0, whiteSpace:"nowrap", textShadow: isList?"none":"0 1px 2px rgba(0,0,0,0.6)" }}>{job.region}</span>
          <span className="f-sans" style={{ fontSize:10, color: isList?"#C8C8C8":"rgba(255,255,255,0.7)", flexShrink:0, whiteSpace:"nowrap" }}>#{job.id}</span>
        </div>
        <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:8 }}>
          <p className="f-mono" style={{ fontSize: isList?16:13, fontWeight: isList?700:800, color: isList?"#00A86B":"#fff", margin:0, textShadow: isList?"none":"0 1px 3px rgba(0,0,0,0.6)" }}>
            {/* 報酬が取れていない行（wide要約の非公開求人フォールバック等）は0円を出さず空にする（ダミー禁止・憲法3条） */}
            {job.pay > 0 ? payLabel(job) : ""}
          </p>
          {!isList && job.dateStartRaw && (
            <span className="f-sans" style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.92)", flexShrink:0, whiteSpace:"nowrap", textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>
              {dateRangeLabel(job.dateStartRaw)}{job.dateEndRaw && job.dateEndRaw !== job.dateStartRaw ? "〜" : ""}
            </span>
          )}
        </div>
        {(job.beginnerOk || job.experiencedPreferred || job.instantApproveRepeat) && (
          <div style={{ display:"flex", gap:4, marginTop: isList?4:6, flexWrap:"wrap" }}>
            {job.beginnerOk && <span className="f-sans" style={{ fontSize: isList?11:9, fontWeight:700, color:"#00A86B", background:"#E6F7EF", padding:"2px 8px", borderRadius:20 }}>🌱 はじめてOK</span>}
            {job.experiencedPreferred && <span className="f-sans" style={{ fontSize: isList?11:9, fontWeight:700, color:"#1A56C5", background:"#E8F0FE", padding:"2px 8px", borderRadius:20 }}>💪 経験者優遇</span>}
            {job.instantApproveRepeat && <span className="f-sans" style={{ fontSize: isList?11:9, fontWeight:700, color:"#8A6D1D", background:"#FFF8E7", padding:"2px 8px", borderRadius:20 }}>🌟 リピート即決</span>}
          </div>
        )}
      </div>
    </a>
  );
}
