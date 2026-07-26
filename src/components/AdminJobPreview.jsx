// 審査プレビュー兼オーナープレビュー（分割・大物①・2026-07-24）：働き手視点の求人詳細を全画面表示。
// 管理タブの審査（掲載/差し戻し）・農家自身の下書き/公開中プレビュー（再開/削除/一時非公開/コピー）の二役。
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import { mapJobPublicRow, payLabel, disp, stationLabel, daysBetweenYmd } from "../lib/utils";
import { StatusRibbon, Carousel, JobFlagBadges, DangerItem, ExpandableText, Avatar } from "./ui";
import { CalendarView } from "./CalendarView";
import { JobLocationMap } from "./JobLocationMap";
import { ContentQTabs, JobQuestions } from "./JobQuestions";
// 求人審査プレビューの「指摘」で選べる問題の種類（2026-07-19・タップ式修正依頼）
const JOB_REVISION_ISSUE_TYPES = ["最低賃金違反","虚偽・誇大の疑い","差別的な条件","連絡先の直書き・外部誘導","危険情報の欠落","個人情報・肖像権","表現が不明瞭","写真が不適切","その他"];

// ── AdminJobPreview（審査前プレビュー：働き手視点の求人詳細を管理者専用RPCで取得し全画面表示） ──
// 求人詳細の描画（写真ギャラリー・情報グリッド・disp()の「ー」・危険箇所・地図・カレンダー）を
// JobSearchMapViewの選択済み求人詳細と同じ見た目で再構成した軽量コンポーネント。
// JobSearchMapViewの詳細ブロックは応募状態(myApplication)・雇い手プロフィール取得・レビュー・
// 関連求人リストと密結合で、管理者プレビュー（未応募・審査中）には持ち込めない部分が多いため、
// mapJobPublicRow()で同じ形に整形したオブジェクトを、表示専用のこのコンポーネントに渡す方式にした。
export function AdminJobPreview({ jobNumber, onClose, onPublish, publishing, onRequestRevision, ownerView, onResumeJob, onDeleteJob, onUnpublishJob, onCopyJob }) {
  const [confirmUnpub, setConfirmUnpub] = useState(false); // 一時非公開の確認ボックス（2026-07-16）
  const [copying, setCopying] = useState(false); // 求人コピー中（2026-07-24）
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSlide, setActiveSlide] = useState(0);
  const [dangerLightbox, setDangerLightbox] = useState(null);
  // タップ式修正依頼（2026-07-19）：審査中、プレビューの各項目の「⚠️指摘」を押して、何がどう問題かを積み上げる
  const [findings, setFindings] = useState([]); // [{target, issueType, note}]
  const [editTarget, setEditTarget] = useState(null); // 指摘編集中の項目ラベル
  const [editIssue, setEditIssue] = useState("");
  const [editNote, setEditNote] = useState("");
  const [revSending, setRevSending] = useState(false);
  const [revSent, setRevSent] = useState(false);
  const findingFor = (label) => findings.find(f => f.target === label);
  const openFindingEditor = (label) => { const f = findingFor(label); setEditTarget(label); setEditIssue(f?.issueType || ""); setEditNote(f?.note || ""); };
  const saveFinding = () => {
    if (!editIssue) return;
    setFindings(prev => { const rest = prev.filter(f => f.target !== editTarget); return [...rest, { target: editTarget, issueType: editIssue, note: editNote }]; });
    setEditTarget(null);
  };
  const removeFinding = (label) => { setFindings(prev => prev.filter(f => f.target !== label)); setEditTarget(null); };
  const buildRevText = () => findings.filter(f => f.issueType).map(f => `【${f.target}】→ ${f.issueType}${f.note.trim() ? `（${f.note.trim()}）` : ""}`).join("\n");
  const submitRevision = async () => {
    const text = buildRevText();
    if (!text || revSending) return;
    setRevSending(true);
    const ok = await onRequestRevision(text); // AdminTab側でRPC送信・成否をbooleanで返す
    setRevSending(false);
    if (ok) { setRevSent(true); setTimeout(() => onClose(), 1200); }
  };
  // 指摘チップ（!ownerViewの審査時のみ表示）：各項目の右上に置く。指摘済みは色反転
  const revChip = (label) => ownerView ? null : (
    <button onClick={(e)=>{ e.stopPropagation(); openFindingEditor(label); }} className="f-sans"
      style={{ position:"absolute", top:8, right:8, zIndex:4, background: findingFor(label) ? "#EA580C" : "rgba(255,255,255,0.95)", color: findingFor(label) ? "#fff" : "#EA580C", border:"1px solid #EA580C", borderRadius:16, padding:"4px 10px", fontSize:11, fontWeight:700, cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.15)" }}>
      {findingFor(label) ? "⚠️ 指摘済み" : "⚠️ 指摘"}
    </button>
  );
  const revOutline = (label) => (!ownerView && findingFor(label)) ? { outline:"2px solid #EA580C", outlineOffset:2 } : {};

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setJob(null);
    (async () => {
      if (ownerView) {
        // 農家本人の求人プレビュー：RLS(owner select)で自分の行のみ読める。審査RPCは使わない
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { if (!cancelled) setLoading(false); return; }
        const { data: row, error } = await supabase.from("jobs").select("*").eq("job_number", jobNumber).eq("farmer_id", session.user.id).maybeSingle();
        if (cancelled) return;
        if (!error && row) setJob(mapJobPublicRow(row));
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.rpc('admin_preview_job', { p_job_number: jobNumber });
      if (cancelled) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (!error && row) setJob(mapJobPublicRow(row));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [jobNumber, ownerView]);

  const handlePhotoScroll = e => {
    const el = e.target;
    setActiveSlide(Math.round(el.scrollLeft / el.clientWidth));
  };

  // document.bodyへポータル（2026-07-19）：呼び出し元の祖先（AdminTabの.appear等）がtransformを
  // 保持していると、その要素がposition:fixedの基準になり全画面に広がらない（審査プレビューが途中で切れる不具合）。
  // bodyへ出せばfixedの基準が確実にビューポートになる
  // cb-lock-scroll＝展開中は背後のページを固定し、下部バー・浮遊☰も隠す（2026-07-26たきと指示）
  return createPortal(
    <div onClick={ownerView ? onClose : undefined} className="cb-lock-scroll" style={ownerView
      ? { position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }
      : { position:"fixed", inset:0, zIndex:9000, background:"#fff", overflowY:"auto" }}>
    {/* 下部バーを隠すso画面下端まで伸ばす（角丸は上だけ・セーフエリアは内側の下パディングで確保） */}
    <div onClick={ownerView ? (e)=>e.stopPropagation() : undefined} className={ownerView ? "cb-sheet-up" : undefined} style={ownerView
      ? { position:"absolute", left:0, right:0, bottom:0, top:"6vh", background:"#fff", borderRadius:"20px 20px 0 0", display:"flex", flexDirection:"column", overflow:"hidden" }
      : undefined}>
      {/* 上部バー：管理者=審査バー／農家本人=✕(戻る)＋再開・削除（ボトムシートのヘッダー） */}
      {ownerView ? (
        <div style={{ padding:"12px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <button onClick={onClose} aria-label="戻る" style={{ width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            {/* 公開中の求人のみ：右上に一時非公開（タップ→確認ボックス・2026-07-16） */}
            {onUnpublishJob && (
              <button onClick={()=>setConfirmUnpub(true)} className="f-sans" style={{ padding:"9px 14px", fontSize:13, fontWeight:700, background:"#fff", color:"#C77700", border:"1px solid #FFB020", borderRadius:10, cursor:"pointer" }}>⏸ 一時非公開</button>
            )}
          </div>
          {(onResumeJob || onDeleteJob) && (
            <div style={{ display:"flex", gap:8, marginTop:10 }}>
              {onResumeJob && (
                <button onClick={onResumeJob} className="f-sans" style={{ flex:1, padding:"11px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>✏️ 再開</button>
              )}
              {onDeleteJob && (
                <button onClick={onDeleteJob} className="f-sans" style={{ flex:1, padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A", borderRadius:10, cursor:"pointer" }}>🗑 削除</button>
              )}
            </div>
          )}
          {/* この求人をコピーして新しい下書きを作る（2026-07-24）：過去の求人の内容を流用 */}
          {onCopyJob && (
            <button onClick={async ()=>{ if (copying) return; setCopying(true); try { await onCopyJob(); } finally { setCopying(false); } }} disabled={copying} className="f-sans" style={{ width:"100%", marginTop:8, padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor: copying ? "default" : "pointer", opacity: copying ? 0.6 : 1 }}>{copying ? "コピー中..." : "📋 この求人をコピーして新規作成"}</button>
          )}
        </div>
      ) : (
      <div style={{
        position:"sticky", top:0, zIndex:10, background:"#FFF8E7", borderBottom:"1px solid #F5D98F",
        padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap",
      }}>
        <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#8A6D1D", margin:0 }}>🔍 審査プレビュー — 各項目の「⚠️指摘」を押して修正を依頼できます</p>
        <div style={{ display:"flex", gap:8, flexShrink:0 }}>
          <button onClick={onClose} className="f-sans" style={{ padding:"8px 16px", fontSize:13, fontWeight:600, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>閉じる</button>
          <button onClick={findings.length > 0 ? submitRevision : ()=>alert("修正を依頼したい項目の「⚠️指摘」を押して、何がどう問題かを入力してください。")} disabled={!job || revSending} className="f-sans" style={{ padding:"8px 16px", fontSize:13, fontWeight:700, background: findings.length > 0 ? "#EA580C" : "#fff", color: findings.length > 0 ? "#fff" : "#EA580C", border:"1px solid #EA580C", borderRadius:10, cursor:"pointer", opacity: (job && !revSending) ? 1 : 0.6 }}>{revSending ? "送信中..." : `修正を依頼${findings.length > 0 ? `（${findings.length}）` : ""}`}</button>
          <button onClick={onPublish} disabled={publishing || !job} className="f-sans" style={{ padding:"8px 16px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity:(publishing||!job)?0.6:1 }}>{publishing ? "公開中..." : "公開する"}</button>
        </div>
      </div>
      )}

      <div style={ownerView ? { flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", paddingBottom:"env(safe-area-inset-bottom, 0px)" } : undefined}>
      <div style={{ maxWidth:720, margin:"0 auto", padding:"24px 20px 100px" }}>
        {loading && (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"60px 0" }}>読み込み中...</p>
        )}
        {!loading && !job && (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"60px 0" }}>求人が見つかりません（権限がないか、削除された可能性があります）</p>
        )}
        {job && (<>
          {/* 写真ギャラリー */}
          {(() => {
            const photos = job.photos.length > 0 ? job.photos : [job.icon, job.icon, job.icon];
            const bgColors = ["#F0F0F0", "#EAEAEA", "#F0F0F0"];
            return (
              <div style={{ position:"relative", borderRadius:12, ...revOutline("写真"), marginBottom:8 }}>
                {revChip("写真")}
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
                          ? <img src={src} alt={cap || ""} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
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

          {/* ヘッダー */}
          <div style={{ position:"relative", marginBottom:20, borderRadius:12, padding: ownerView ? 0 : 4, ...revOutline("求人タイトル・募集タグ") }}>
            {revChip("求人タイトル・募集タグ")}
            <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:0, lineHeight:1.3 }}>{job.crop} {job.task}{job.region ? `｜${job.region}` : ""}</h2>
            <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"4px 0 0", userSelect:"text" }}>#{job.id}</p>
            {(job.beginnerOk || job.experiencedPreferred || job.instantApproveRepeat) && (
              <div style={{ display:"flex", gap:6, marginTop:8, flexWrap:"wrap" }}>
                <JobFlagBadges beginner={job.beginnerOk} expert={job.experiencedPreferred} repeat={job.instantApproveRepeat} />
              </div>
            )}
          </div>

          {/* 主要情報 */}
          <div style={{ position:"relative", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5, ...revOutline("報酬・勤務条件・日程") }}>
            {revChip("報酬・勤務条件・日程")}
            <div className="job-detail-info-grid">
              {[
                // 日程は確認ページと同じ設計（2026-07-16）：「〜終了日」を下段に折り返し
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
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"10px 0 0" }}>支払方法：当日現金手渡し</p>
          </div>

          {/* 作業説明 */}
          {job.jobBody && job.jobBody.trim() && (
          <div style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5, ...revOutline("作業内容") }}>
            {revChip("作業内容")}
            <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>作業内容</p>
            <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, overflowWrap:"break-word", wordBreak:"break-word" }}>{job.jobBody}</p>
          </div>
          )}

          {/* 経験・持ち物・備考（配列駆動・未入力は「ー」）。希望する働き手は削除・必要経験と持ち物はバッジ表示（2026-07-16） */}
          <div style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5, ...revOutline("持ち物・備考") }}>
            {revChip("持ち物・備考")}
            {[
              { label:"持ち物",     value: disp(job.items), chips:true, pin:true },
              { label:"備考・注意", value: disp(job.cautions) },
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
          <div style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:20, ...revOutline("危険箇所") }}>
            {revChip("危険箇所")}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:20 }}>
              <span style={{ fontSize:18 }}>⚠️</span>
              <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>作業上の注意・危険箇所</h3>
            </div>

            {(job.dangerPlaces && job.dangerPlaces.length > 0) && (
              <>
                <div style={{ display:"flex", flexDirection:"column", gap:16, marginBottom:28 }}>
                  {job.dangerPlaces.map((place, i) => {
                    const placePhotos = place.photos || [];
                    return (
                    <DangerItem key={i} icon={place.icon} label={place.label} desc={place.desc} photos={placePhotos} onPhotoClick={setDangerLightbox} />
                    );
                  })}
                </div>
              </>
            )}

            {(job.dangerTasks && job.dangerTasks.length > 0) && (
              <>
                <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                  {job.dangerTasks.map((task, i) => {
                    const taskPhotos = task.photos || [];
                    return (
                    <DangerItem key={i} icon={task.icon} label={task.label} desc={task.desc} photos={taskPhotos} onPhotoClick={setDangerLightbox} />
                    );
                  })}
                </div>
              </>
            )}
          </div>
          )}

          {/* 地図（集合場所のおおよその範囲・円のみ） */}
          <div style={{ position:"relative", width:"100%", marginBottom:20, borderRadius:12, ...revOutline("場所・地図") }}>
            {revChip("場所・地図")}
            <JobLocationMap lat={job.lat} lng={job.lng} radius={job.radius} label={job.region} />
          </div>

          {/* 開催期間カレンダー */}
          {job.dateStart && (
            <div style={{ marginBottom:20 }}>
              <CalendarView start={job.dateStart} end={job.dateEnd} readOnly={true} />
            </div>
          )}
        </>)}
      </div>
      </div>

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

      {/* 指摘エディタ（2026-07-19）：項目の「⚠️指摘」タップで開く。何がどう問題かを選んで補足を書く */}
      {editTarget && createPortal(
        <div onClick={()=>setEditTarget(null)} style={{ position:"fixed", inset:0, zIndex:10050, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:420, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <button onClick={()=>setEditTarget(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#EA580C", margin:"0 0 4px" }}>この項目を指摘</p>
            <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:"0 0 14px" }}>【{editTarget}】</p>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#222", margin:"0 0 8px" }}>どう問題ですか？</p>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
              {JOB_REVISION_ISSUE_TYPES.map(t => (
                <button key={t} onClick={()=>setEditIssue(t)} className="f-sans" style={{ padding:"8px 12px", borderRadius:20, border: editIssue === t ? "2px solid #EA580C" : "1px solid #EBEBEB", background: editIssue === t ? "#FFF1E7" : "#fff", fontSize:12, fontWeight:600, color: editIssue === t ? "#EA580C" : "#717171", cursor:"pointer" }}>{t}</button>
              ))}
            </div>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#222", margin:"0 0 8px" }}>何がダメか・どう直すか（任意）</p>
            <textarea value={editNote} onChange={e=>setEditNote(e.target.value)} placeholder="例：時給が最低賃金を下回っています。980円以上にしてください。" rows={3} className="field f-sans" style={{ fontSize:13, marginBottom:14, resize:"vertical" }} />
            <div style={{ display:"flex", gap:8 }}>
              {findingFor(editTarget) && (
                <button onClick={()=>removeFinding(editTarget)} className="f-sans" style={{ padding:"12px 14px", fontSize:13, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>指摘を取消</button>
              )}
              <button onClick={saveFinding} disabled={!editIssue} className="f-sans" style={{ flex:1, padding:"12px", fontSize:14, fontWeight:700, background: editIssue ? "#EA580C" : "#EBEBEB", color: editIssue ? "#fff" : "#717171", border:"none", borderRadius:10, cursor:"pointer" }}>この指摘を保存</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 送信完了トースト（2026-07-19） */}
      {revSent && createPortal(
        <div style={{ position:"fixed", inset:0, zIndex:10060, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:24, animation:"fadeIn .2s ease" }}>
          <div className="cb-sheet-up" style={{ background:"#fff", borderRadius:16, padding:"28px 24px", maxWidth:340, width:"100%", textAlign:"center" }}>
            <div style={{ fontSize:40, marginBottom:10 }}>✉️</div>
            <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 6px" }}>修正依頼を送りました</p>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.7, margin:0 }}>農家にチャットとメールで届きます。求人は「作成中」に戻ります。</p>
          </div>
        </div>,
        document.body
      )}

      {/* 一時非公開の確認ボックス（2026-07-16）：はい=非公開化・いいえ/背景タップ=閉じる */}
      {confirmUnpub && (
        <div onClick={e => { e.stopPropagation(); setConfirmUnpub(false); }} style={{ position:"fixed", inset:0, zIndex:9600, background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div onClick={e => e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:20, padding:"24px 20px", maxWidth:360, width:"100%", boxShadow:"0 12px 48px rgba(0,0,0,0.25)" }}>
            <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:"0 0 8px" }}>この求人を一時非公開にしますか？</p>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.8, margin:"0 0 18px" }}>
              非公開にすると「作成中」に移動し、内容を編集できます。働き手からは見えなくなります。再掲載するときは、もう一度審査を通ります。
            </p>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => { setConfirmUnpub(false); onUnpublishJob && onUnpublishJob(); }} className="f-sans" style={{ flex:1, padding:"12px", fontSize:14, fontWeight:700, background:"#C77700", color:"#fff", border:"none", borderRadius:12, cursor:"pointer" }}>はい、一時非公開にする</button>
              <button onClick={() => setConfirmUnpub(false)} className="f-sans" style={{ flex:1, padding:"12px", fontSize:14, fontWeight:600, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:12, cursor:"pointer" }}>いいえ</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>,
    document.body
  );
}
