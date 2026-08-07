// 求人詳細の本文（2026-08-07たきと指示「求人詳細ページをボックス化している要素をトレース。
// ただし浮遊ボックスは除外」）：AdminJobPreview（審査・オーナープレビュー＝求人詳細ページの
// ボックス化）の本文をそのまま写した表示専用部品。
// 【除外＝浮遊・操作系】指摘チップ／掲載前の確認の記録／公開の右スワイプ緑面／下部の操作バー／
// ⏸一時非公開／指摘エディタ。残したのは働き手が見る本文だけ：
// 写真ギャラリー→ヘッダー→主要情報→作業内容→持ち物・備考→危険箇所→地図→期間カレンダー。
// job は mapJobPublicRow() で整形済みのオブジェクトを渡すこと。
// ※本文の見た目を変えるときは AdminJobPreview 側と揃える（出どころが同じ・枝分かれさせない）
import { useState } from "react";
import { payLabel, disp, stationLabel, payTermsLine, overtimeLine } from "../lib/utils";
import { Carousel, JobFlagBadges, DangerItem, MaskedAddress } from "./ui";
import { CalendarView } from "./CalendarView";
import { JobLocationMap } from "./JobLocationMap";

export function JobDetailBody({ job }) {
  const [activeSlide, setActiveSlide] = useState(0);
  const [dangerLightbox, setDangerLightbox] = useState(null);
  if (!job) return null;
  const handlePhotoScroll = e => {
    const el = e.target;
    setActiveSlide(Math.round(el.scrollLeft / el.clientWidth));
  };
  return (
    <div>
      {/* 写真ギャラリー（原寸＝詳細・審査プレビューと同じ扱い。カード用サムネにしない・2026-08-02規則） */}
      {(() => {
        const photos = job.photos.length > 0 ? job.photos : [job.icon, job.icon, job.icon];
        const bgColors = ["#F0F0F0", "#EAEAEA", "#F0F0F0"];
        return (
          <div style={{ position:"relative", borderRadius:12, marginBottom:8 }}>
            <Carousel
              className="carousel-scroll"
              style={{ display:"flex", overflowX:"auto", scrollSnapType:"x mandatory" }}
              wrapperStyle={{ marginBottom:8 }}
              onScroll={handlePhotoScroll}
            >
              {photos.map((photo, i) => {
                const src = typeof photo === "string" ? photo : photo?.url;
                const cap = typeof photo === "string" ? "" : photo?.caption;
                return (
                  <div key={i} style={{
                    flexShrink:0, width:"100%", height:392, borderRadius:12,
                    background: bgColors[i % bgColors.length],
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:72,
                    scrollSnapAlign:"start", position:"relative", overflow:"hidden",
                  }}>
                    {job.photos.length > 0
                      ? <img loading="lazy" src={src} alt={cap || ""} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                      : photo}
                    {cap && (
                      <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"28px 20px 16px", background:"linear-gradient(transparent, rgba(0,0,0,0.65))", color:"#fff", fontSize:16, fontWeight:600, boxSizing:"border-box" }}>{cap}</div>
                    )}
                  </div>
                );
              })}
            </Carousel>
            <div style={{ display:"flex", justifyContent:"center", gap:6, marginTop:8 }}>
              {photos.map((_, i) => (
                <span key={i} style={{ fontSize:10, color: i===activeSlide ? "#00A86B" : "#D0D0D0" }}>{i===activeSlide ? "●" : "○"}</span>
              ))}
            </div>
          </div>
        );
      })()}
      <div style={{ marginBottom:12 }} />

      {/* ヘッダー。番地の開示はDB側が正（jobs_publicのanonマスク）＝ログインしていれば届いた値が出る */}
      <div style={{ position:"relative", marginBottom:20 }}>
        <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:0, lineHeight:1.3 }}>
          {job.crop} {job.task}{job.region ? `｜${job.region}` : ""}
          {job.region && <MaskedAddress value={job.workAddress} unlocked={true} exists={job.hasWorkAddress} />}
        </h2>
        <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"4px 0 0", userSelect:"text" }}>#{job.id}</p>
        {(job.beginnerOk || job.experiencedPreferred || job.instantApproveRepeat) && (
          <div style={{ display:"flex", gap:6, marginTop:8, flexWrap:"wrap" }}>
            <JobFlagBadges beginner={job.beginnerOk} expert={job.experiencedPreferred} repeat={job.instantApproveRepeat} />
          </div>
        )}
      </div>

      {/* 主要情報 */}
      <div style={{ position:"relative", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
        <div className="job-detail-info-grid">
          {[
            { label:"日程",     value: (job.dateLabel || "").replace("〜", "\n〜") },
            { label:"勤務時間", value: job.workTime },
            { label:"休憩時間", value: job.breakTime },
            { label:"採用人数", value: job.count },
            { label:"移動時間", value: stationLabel(job.nearestStation, job.commuteTime) },
            { label:"報酬",     value: payLabel(job) },
          ].filter(row => row.value && String(row.value).trim()).map(row => (
            <div key={row.label} style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"center", textAlign:"center" }}>
              <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0" }}>{row.label}</span>
              <span className="f-sans" style={{ fontSize:15, color:"#222", fontWeight:600, lineHeight:1.6, whiteSpace:"pre-line" }}>{row.value}</span>
            </div>
          ))}
        </div>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"10px 0 0" }}>{payTermsLine(job)}</p>
      </div>

      {/* 作業説明 */}
      {job.jobBody && job.jobBody.trim() && (
      <div style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
        <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>作業内容</p>
        <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, overflowWrap:"break-word", wordBreak:"break-word" }}>{job.jobBody}</p>
      </div>
      )}

      {/* 経験・持ち物・備考（配列駆動・未入力は「ー」） */}
      <div style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
        {[
          { label:"持ち物",     value: disp(job.items), chips:true, pin:true },
          { label:"備考・注意", value: disp(job.cautions) },
          { label:"時間外労働", value: disp(overtimeLine(job.overtimePolicy, job.overtimeDetail)) },
        ].map(row => (
          <div key={row.label} style={{ padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
            <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", display:"block", marginBottom:2, textAlign:"center" }}>{row.label}</span>
            {row.chips && row.value !== "ー"
              ? (
                <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:2, justifyContent:"center" }}>
                  {String(row.value).split(/[、,・\n／/]+/).map(s => s.trim()).filter(Boolean).map((c, i) => (
                    <span key={i} className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", background:"#F7F7F7", borderRadius:20, padding:"6px 14px" }}>{row.pin ? "📌 " : ""}{c}</span>
                  ))}
                </div>
              )
              : <span className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.6, overflowWrap:"break-word", wordBreak:"break-word", display:"block", textAlign:"center" }}>{row.value}</span>}
          </div>
        ))}
      </div>

      {/* 危険区域セクション（両方空なら見出しごと非表示） */}
      {((job.dangerPlaces && job.dangerPlaces.length > 0) || (job.dangerTasks && job.dangerTasks.length > 0)) && (
      <div style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:20 }}>
          <span style={{ fontSize:18 }}>⚠️</span>
          <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>作業上の注意・危険箇所</h3>
        </div>
        {(job.dangerPlaces && job.dangerPlaces.length > 0) && (
          <div style={{ display:"flex", flexDirection:"column", gap:16, marginBottom:28 }}>
            {job.dangerPlaces.map((place, i) => (
              <DangerItem key={i} icon={place.icon} label={place.label} desc={place.desc} photos={place.photos || []} onPhotoClick={setDangerLightbox} />
            ))}
          </div>
        )}
        {(job.dangerTasks && job.dangerTasks.length > 0) && (
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            {job.dangerTasks.map((task, i) => (
              <DangerItem key={i} icon={task.icon} label={task.label} desc={task.desc} photos={task.photos || []} onPhotoClick={setDangerLightbox} />
            ))}
          </div>
        )}
      </div>
      )}

      {/* 地図（集合場所のおおよその範囲・円のみ） */}
      <div style={{ position:"relative", width:"100%", marginBottom:20, borderRadius:12 }}>
        <JobLocationMap lat={job.lat} lng={job.lng} radius={job.radius} label={job.region}
          mapQuery={job.workAddress ? job.region + job.workAddress : job.region}
          addressShown={!!job.workAddress} />
      </div>

      {/* 開催期間カレンダー */}
      {job.dateStart && (
        <div style={{ marginBottom:20 }}>
          <CalendarView start={job.dateStart} end={job.dateEnd} readOnly={true} holidays={job.holidays} />
        </div>
      )}

      {/* 危険箇所の写真ライトボックス（全画面拡大） */}
      {dangerLightbox && (
        <div onClick={() => setDangerLightbox(null)} style={{
          position:"fixed", inset:0, zIndex:10000,
          background:"rgba(0,0,0,0.92)",
          display:"flex", alignItems:"center", justifyContent:"center",
          cursor:"pointer", animation:"fadeIn .2s ease", padding:16,
        }}>
          <button onClick={e => { e.stopPropagation(); setDangerLightbox(null); }} style={{
            position:"absolute", top:20, right:20,
            width:40, height:40, borderRadius:"50%",
            background:"rgba(255,255,255,0.15)", border:"none",
            color:"#fff", fontSize:22, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>✕</button>
          <img src={dangerLightbox} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain", borderRadius:8 }} />
        </div>
      )}
    </div>
  );
}
