// 今日ページの段階パネル（第2次構造改革 Phase 4-B・2026-08-18に TodayPage.jsx から移設）。
// TodayPage の state を1つも持たない（props と自分の state だけで完結する）ので、ファイルを分けても
// 所有権は動かない。現在の中身＝緊急連絡・採用する の2パネル（面接の回答・新着の応募の
// 2パネルは、その箱を廃止した2026-08-19に削除した）。
//
// ★モジュールレベル定義を維持すること（移設後も同じ）：親の中で定義すると再レンダーのたびに
//   再マウントされ、textarea のフォーカス・下書き・花びらの演出が途切れる
//   （LandingFlow のフォーカス消失バグと同族・CLAUDE.md）。
import { useState, useEffect, useRef } from "react";
import { useSheetDragClose } from "../../../lib/sheetDrag";
import { confirmTerms, fetchMyFarmJobs, fetchPublicJobsByNumbers } from "../todayApi";
import { getCache, setCache } from "../../../lib/viewCache";
import { calFmtDate, ROLE_ORANGE, ROLE_GREEN, photoThumb, mapJobPublicRow,
  appPhaseKey, phaseLabelNow, phaseColorNow, APP_PHASE_LABEL, APP_PHASE_COLOR, APP_PHASE_DESC, CHAT_ELIGIBLE_STATUSES } from "../../../lib/utils";
import { openPhaseInfo } from "../../../lib/previewBus";
import { findDoubleBookingJob, doubleBookingWarning, HIRE_NAME_DISCLOSURE_NOTE } from "../../../lib/hire";
import { Avatar, Dots } from "../../../components/ui";
import ContractPartyName from "../../../components/ContractPartyName";
import ContractEmergencyContact from "../../../components/ContractEmergencyContact";
import { JobCard } from "../../../components/JobCard";
import { WorkerReviewSheet } from "../../../components/WorkerReviewSheet";
import { DayReportSheet } from "../../../components/DayReportSheet";
import { Celebration } from "../../../components/Celebration";


// 緊急連絡の専用ページ（2026-08-02たきと指示「ステータスと同じ構造に」）：
// ステータスページ(#/saved・SavedJobsView)と同じカード構造＝左:求人トップ写真＋タイトル/#No.オーバーレイ／
// 右:相手のアイコン＋段階ラベル。カードタップでボックス（下からのシート）が開き、
// 実行（⚠️緊急連絡・チャット・求人ページ）はシート内のボタンが担う。
// ★モジュールレベル定義を維持すること：親内で定義すると再レンダーごとに再マウントされる（フォーカス消失バグの同族）
export function EmergencyStagePanel({ items, role, meId }) {
  const [boxItem, setBoxItem] = useState(null); // 展開中のボックス（ステータスページのboxJobと同じ作法）
  // ⚠️緊急連絡の中身＝その日の記録の入力（今日の記録の箱と同じ共有部品・2026-08-19）。
  // ★従来は #/emergency/{id} へ飛ばしていたが、その行き先のページは2026-08-19の
  //   緊急連絡モーダル削除で無くなっており、profileページに着地して何も開かない状態だった。
  //   入力を作り直したのでこの場で開く（新しいルートは足さない）
  const [reportApp, setReportApp] = useState(null);
  // 下スワイプで閉じる（指に連動・応募者ページのボックスと同じ規則・2026-08-19）
  const boxSheetRef = useRef(null), boxScrollRef = useRef(null);
  useSheetDragClose(boxSheetRef, boxScrollRef, ()=>setBoxItem(null), !!boxItem);
  // 段階はステータスページと同じ導出（appPhaseKey＝帯の唯一のソース。entriesはterms_confirmed_*を持つ）
  const phaseOf = (e) => e.application_id ? appPhaseKey({ status: e.application_status,
    terms_confirmed_worker_at: e.terms_confirmed_worker_at, terms_confirmed_farmer_at: e.terms_confirmed_farmer_at }) : null;
  const titleOf = (e) => [e.crop, e.task].filter(Boolean).join(" ") || `求人 #${e.job_number}`;
  // 相手アイコンは相手の役割色で統一（2026-08-02たきと指示「働き手のアイコンはオレンジ。農家はミドリ」）：
  // リングも未設定時の下地も役割色（チャットの役割色枠と同じ規約・2026-07-22）。段階は下のラベル文字色が担う
  const partnerColor = role === "farmer" ? ROLE_ORANGE : ROLE_GREEN;
  return (
    <>
      <div style={{ display:"grid", gap:10 }}>
        {items.map(e => {
          const photo = photoThumb(e.photos?.[0]);
          const phase = phaseOf(e);
          return (
            <div key={e.application_id} style={{ position:"relative", display:"flex", alignItems:"stretch", background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, overflow:"hidden" }}>
              {/* 左：求人のトップ写真。タイトル・#No.を写真下部に重ねる（ステータスページと同じ作法・枠は3:4固定） */}
              <button onClick={()=>setBoxItem(e)} aria-label="この仕事の緊急連絡を開く" className="f-sans"
                style={{ flexShrink:0, width:104, aspectRatio:"3 / 4", padding:0, border:"none", borderRight:"1px solid #F0F0F0", background:"#F2F2F2", cursor:"pointer", position:"relative", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, textAlign:"left" }}>
                {photo ? <img src={photo} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌱"}
                <span style={{ position:"absolute", left:0, right:0, bottom:0, padding:"18px 8px 7px", background:"linear-gradient(transparent, rgba(0,0,0,0.72))", boxSizing:"border-box" }}>
                  <span style={{ display:"block", fontSize:13, fontWeight:700, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>{titleOf(e)}</span>
                  <span style={{ display:"block", fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.82)", marginTop:1, textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>#{e.job_number}</span>
                </span>
              </button>
              {/* 右：相手のアイコン＋段階（緊急連絡は相手に送るもの＝誰宛かを主役に。アイコンは役割色） */}
              <div style={{ flex:1, minWidth:0, padding:"10px 12px 8px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <button onClick={()=>setBoxItem(e)} className="f-sans"
                  style={{ width:72, background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center" }}>
                  <Avatar url={e.partner_avatar} name={e.partner_name || "？"} size={52} ring={partnerColor} bg={partnerColor} />
                  <span style={{ display:"block", width:"100%", fontSize:11, fontWeight:600, color:"#222", marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.partner_name ? e.partner_name + "さん" : "相手"}</span>
                  {phase && <span onClick={(ev)=>{ ev.stopPropagation(); openPhaseInfo(phase); }} role="button" style={{ display:"block", fontSize:9, fontWeight:700, color:phaseColorNow(phase, e), marginTop:1, cursor:"pointer" }}>{phaseLabelNow(phase, e) || ""}</span>}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {/* ═══ カードタップで展開するボックス（ステータスページのシートと同じ作法） ═══ */}
      {boxItem && (() => {
        const e = boxItem;
        const phase = phaseOf(e);
        const c = phase ? phaseColorNow(phase, e) : "#717171";
        const photo = photoThumb(e.photos?.[0]);
        const dateLabel = e.date_start ? (e.date_end && e.date_end !== e.date_start ? `${calFmtDate(e.date_start)}〜${calFmtDate(e.date_end)}` : calFmtDate(e.date_start)) : "未設定";
        const chatOk = !!(e.application_id && CHAT_ELIGIBLE_STATUSES.includes(e.application_status));
        return (
          <div onClick={()=>setBoxItem(null)} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
            <div ref={boxSheetRef} onClick={ev=>ev.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:0, maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:"20px 20px 0 0", display:"flex", flexDirection:"column", overflow:"hidden" }}>
              <div style={{ padding:"12px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
              </div>
              <div ref={boxScrollRef} style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"16px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
                {/* 現在地バナー（ステータスページと同じ・段階色＋APP_PHASE_DESC＝説明の唯一のソース） */}
                {phase && (
                  <div style={{ background: c + "14", borderLeft: "4px solid " + c, borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
                    {/* ★作業中は「今日」で出し分ける（2026-08-18たきと指示「作業していない時間は作業中ではない」）
                        ＝働く日でない日は「次は 8/20(木)」。説明文は段階の説明ので従来どおり */}
                    <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:c, margin:0 }}>{phaseLabelNow(phase, e) || ""}</p>
                    {APP_PHASE_DESC[phase] && (
                      <p className="f-sans" style={{ fontSize:12, color:"#555", lineHeight:1.7, margin:"3px 0 0" }}>{APP_PHASE_DESC[phase]}</p>
                    )}
                  </div>
                )}
                {/* 求人の要約（写真・タイトル・#No.・地域・日程・勤務時間・相手） */}
                <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12 }}>
                  <div style={{ flexShrink:0, width:88, height:88, borderRadius:12, overflow:"hidden", background:"#F2F2F2", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28 }}>
                    {photo ? <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌱"}
                  </div>
                  <div style={{ minWidth:0 }}>
                    <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:0 }}>{titleOf(e)}</p>
                    <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"2px 0 0" }}>#{e.job_number}{e.town ? "　" + e.town : ""}</p>
                    <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>📅 {dateLabel}{e.work_time ? "　🕒" + e.work_time : ""}</p>
                    {e.partner_name && <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"2px 0 0" }}>相手 {e.partner_name}さん</p>}
                  </div>
                </div>
                {/* 契約成立後のみ相手の本名を開示（当事者間・KYC非複製・2026-07-30たきと裁定(B)） */}
                {e.application_id && <ContractPartyName applicationId={e.application_id} showPending={false} style={{ margin:"0 0 12px", paddingLeft:2 }} />}
                {/* 緊急連絡先も採用成立後のみ（同じ窓口作法・2026-08-03）。緊急連絡の直前で相手の連絡先が見える */}
                {e.application_id && <ContractEmergencyContact applicationId={e.application_id} style={{ margin:"0 0 12px" }} />}
                {/* 操作（ステータスページのボタン群と同じ位置づけ。主役＝緊急連絡） */}
                <div style={{ display:"grid", gap:8 }}>
                  <button onClick={()=>{ setBoxItem(null); setReportApp({ id: e.application_id }); }} className="f-sans"
                    style={{ padding:"12px", fontSize:14, fontWeight:700, background:"#E24B4A", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>⚠️ 緊急連絡をする</button>
                  {chatOk && (
                    <button onClick={()=>{ setBoxItem(null); window.location.hash = "/chat/" + e.application_id; }} className="f-sans"
                      style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>💬 チャットを開く</button>
                  )}
                  <button onClick={()=>{ setBoxItem(null); try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {} window.location.hash = "/work/job/" + e.job_number; }} className="f-sans"
                    style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#555", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>求人ページを見る</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      {/* その日の記録の入力（今日の記録の箱と同じ共有部品＝入力と保存を2箇所で枝分かれさせない） */}
      <DayReportSheet app={reportApp} meId={meId} role={role}
        onClose={()=>setReportApp(null)} onDone={()=>setReportApp(null)} />
    </>
  );
}

// 応募者ページへの着地：どの応募のシートを開くかだけを渡す（詳しく見たい時の導線）。
// ★農家の採用の実行窓口は、この採用するページ（下の HireStagePanel）だけ。
//   応募者シートの🤝はリンクに変更（2026-08-19）、チャットの採用ボックスも削除（2026-08-19）。
//   二重予約の判定と告知文は lib/hire に集約＝ここが唯一の使い手。
//   実行は confirm_terms＝人数上限・見送りの波及・権限・二重予約の壁はDB側が担保する
export const HIRE_SHEET_PATH = "/profile/employer/applicants";
export function markHireSheet(applicationId) {
  try {
    sessionStorage.setItem("cb_appFilter", "interview");        // 着地先の絞り込みを「面接中」に
    if (applicationId) sessionStorage.setItem("cb_openApplicantId", applicationId); // その応募のシートを自動展開
  } catch {}
}

// 採用するページ（2026-08-06たきと指示「応募者ページと同じ構造に。ただし応募者単位」）：
// 応募者ページ（FarmerDashboard・#/profile/employer/applicants）のカード＝左に求人のトップ写真
// （タイトル・#No.を下部に重ねる）／右に働き手のアイコン（リング＝段階色）＋名前＋段階、をそのまま使う。
// 違いは束ね方だけ＝応募者ページは1枚のカードに1求人（応募者アイコンが横に並ぶ）／このページは1枚＝1応募者。
// カードは横2分割（写真／アイコン）。2026-08-19たきと指示「採用する枠削除。カードタップで採用する最終確認」＝
// 3列目の🤝採用ボタンと、間に挟んでいた要約ボックスを廃止し、カードのどこを押しても最終確認が開く。
// OKでその場で採用（ページ遷移しない・2026-08-06たきと指示）。決める前に見たい時の導線
// （チャット・応募者ページ）は最終確認の中に小さく置いた。
// ★モジュールレベル定義を維持すること：親内で定義すると再レンダーごとに再マウントされる（フォーカス消失バグの同族）
export function HireStagePanel({ items, meId, onHired }) {
  // 最終確認（2026-08-06たきと指示「ここで採用を押す。最終確認。OKタップで採用。ページ遷移しない」）：
  // 🤝タップ→この画面内の確認カード→OKで confirm_terms を実行。応募者ページへは飛ばさない。
  // ★確認に必ず載せるもの＝二重予約の警告（lib/hire・応募者シートと同じ判定）と、
  //   契約成立で本名が相互開示されること（2026-07-30たきと裁定(B)の「採用confirmに明示」）
  const [confirmItem, setConfirmItem] = useState(null); // { ...todo, dup:number|null, checking:bool }
  const [hiring, setHiring] = useState(false);
  const [done, setDone] = useState(null);   // 採用アニメーション { name, jobNumber, extra }
  const [hiredIds, setHiredIds] = useState(() => new Set()); // 採用済み＝この画面から消す（やることが片付く）
  const openConfirm = async (t) => {
    setConfirmItem({ ...t, dup: null, checking: true });
    const dup = meId ? await findDoubleBookingJob(meId, t.partner_id, t.job_number) : null;
    setConfirmItem(prev => (prev && prev.application_id === t.application_id) ? { ...prev, dup, checking: false } : prev);
  };
  const runHire = async () => {
    const t = confirmItem;
    if (!t || hiring) return;
    setHiring(true);
    // 二重予約はDB側confirm_termsも同じ式で見張る（2026-08-06・警告の機構化）。警告を見て
    // OKした時（t.dupあり）だけ受諾フラグを渡す。下調べが取りこぼした時はDBがdouble_bookedを
    // 返すので、確認カードに警告を出し直し、もう一度OKで受諾ありになる
    const { data, error } = await confirmTerms(t.application_id, !!t.dup);
    setHiring(false);
    if (!error && data?.reason === "double_booked") {
      setConfirmItem(prev => (prev && prev.application_id === t.application_id) ? { ...prev, dup: data.dup_job, checking: false } : prev);
      alert("日程の重なる別の求人が見つかりました。警告の内容を確認のうえ、もう一度OKを押すと採用が確定します。");
      return;
    }
    if (error || !data?.ok) { alert("処理に失敗しました：" + (data?.reason || error?.message || "不明")); return; }
    // 人数に達した場合、残りの応募はDB側（confirm_terms）が見送りにする。件数はそのまま伝える
    const closed = Array.isArray(data.closed_ids) ? data.closed_ids.length : 0;
    const extra = !data.filled ? "" : (closed > 0
      ? `募集人数に達したため、残りの応募 ${closed} 件は見送りになりました（お相手へ連絡済み）。`
      : "募集人数に達したため、この求人の募集は終了です。");
    setConfirmItem(null);
    setDone({ appId: t.application_id, name: t.partner_name, jobNumber: t.job_number, extra });
    setHiredIds(prev => new Set(prev).add(t.application_id)); // この画面からは即座に消す
  };
  // ★親のやることから消すのは演出を閉じた後（2026-08-06）：先に消すと、最後の1件だった時に
  //   親が空状態へ切り替わってこのパネルごと消え、採用アニメーションが一瞬で消える
  const closeDone = () => {
    if (done?.appId && onHired) onHired(done.appId); // 今日ページのやること・件数バッジからも片付ける
    setDone(null);
  };
  // 求人のトップ写真だけは my_todo_items が返さないため、求人ページ・応募者ページと同じ
  // farm:jobInfo（my_farm_jobs 由来・{job_number:{crop,task,date_start,date_end,photos,holidays}}）から借りる。
  // キャッシュがあれば即描画→無ければ裏で1往復（新しいDBオブジェクトは作らない）
  const [jobInfo, setJobInfo] = useState(() => getCache("farm:jobInfo") ?? {});
  const missing = items.some(t => t.job_number && !jobInfo[t.job_number]);
  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: bundle } = await fetchMyFarmJobs();
        if (cancelled || !bundle?.jobs) return;
        const jim = Object.fromEntries(bundle.jobs.map(j => [j.job_number, { crop:j.crop, task:j.task, date_start:j.date_start, date_end:j.date_end, photos:j.photos, holidays:j.holidays }]));
        setJobInfo(jim); setCache("farm:jobInfo", jim);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [missing]);
  // 段階は記録から導出：my_todo_items の hire は「status in (approved,meeting,interview) かつ
  // terms_confirmed_farmer_at が無い」＝appPhaseKey でいう「面接中」だけが並ぶ（別の表示用状態を持たない）
  const phase = appPhaseKey({ status: "approved" });
  const phaseColor = APP_PHASE_COLOR[phase];
  const titleOf = (t) => [t.crop, t.task].filter(Boolean).join(" ") || `求人 #${t.job_number}`;
  const dateOf = (t) => t.date_start ? (t.date_end && t.date_end !== t.date_start ? `${calFmtDate(t.date_start)}〜${calFmtDate(t.date_end)}` : calFmtDate(t.date_start)) : "未設定";
  const photoOf = (t) => photoThumb(jobInfo[t.job_number]?.photos?.[0]);
  // 採用した応募はこの場から消える（ページ遷移せずに、やることが片付いたことが見てわかる）
  const shown = items.filter(t => !hiredIds.has(t.application_id));
  return (
    <>
      {/* 採用の演出（下の SUCCESS 用）。keyframesは使う場所に同居させる（花びらの演出と同じ作法＝keyframesは使う場所に置く） */}
      <style>{`
@keyframes cbHireSeal{0%{transform:scale(.3) rotate(-18deg);opacity:0}45%{transform:scale(1.18) rotate(4deg);opacity:1}70%{transform:scale(.95) rotate(0)}100%{transform:scale(1) rotate(0);opacity:1}}
@keyframes cbHireRing{0%{transform:scale(.5);opacity:.55}100%{transform:scale(2.6);opacity:0}}
@keyframes cbHireBurst{0%{transform:translate(0,0) scale(.4);opacity:0}20%{opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1);opacity:0}}
@keyframes cbHireText{0%{transform:translateY(10px);opacity:0}100%{transform:translateY(0);opacity:1}}
`}</style>
      <div style={{ display:"grid", gap:10 }}>
        {shown.length === 0 && (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"28px 0" }}>採用しました。この用事は片付きました</p>
        )}
        {shown.map(t => {
          const photo = photoOf(t);
          return (
            /* 横幅を2分割（2026-08-19たきと指示）：写真／アイコン。どちらを押しても最終確認が開く
               ＝カード全体が「この人を採用する」の入口（押す場所を選ばせない） */
            <div key={t.application_id} style={{ position:"relative", display:"flex", alignItems:"stretch", background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, overflow:"hidden" }}>
              {/* ①求人のトップ写真＋タイトル・#No.（応募者ページのカードと同じ作法・枠は3:4固定） */}
              <button onClick={()=>openConfirm(t)} aria-label="この応募者を採用する" className="f-sans"
                style={{ flex:"1 1 0", minWidth:0, aspectRatio:"3 / 4", padding:0, border:"none", borderRight:"1px solid #F0F0F0", background:"#F2F2F2", cursor:"pointer", position:"relative", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, textAlign:"left" }}>
                {photo ? <img src={photo} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌱"}
                <span style={{ position:"absolute", left:0, right:0, bottom:0, padding:"18px 8px 7px", background:"linear-gradient(transparent, rgba(0,0,0,0.72))", boxSizing:"border-box" }}>
                  <span style={{ display:"block", fontSize:13, fontWeight:700, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>{titleOf(t)}</span>
                  <span style={{ display:"block", fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.82)", marginTop:1, textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>#{t.job_number}</span>
                </span>
              </button>
              {/* ②この応募の働き手ひとり（応募者ページのアイコン列と同じ見た目＝リングは段階色・
                  未設定アイコンの下地は相手の役割色＝働き手のオレンジ） */}
              <div style={{ flex:"1 1 0", minWidth:0, padding:"10px 8px 8px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <button onClick={()=>openConfirm(t)} aria-label="この応募者を採用する" className="f-sans"
                  style={{ width:"100%", maxWidth:88, background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center" }}>
                  <Avatar url={t.partner_avatar} name={t.partner_name || "？"} size={52} ring={phaseColor} bg={ROLE_ORANGE} />
                  <span style={{ display:"block", width:"100%", fontSize:11, fontWeight:600, color: t.partner_name ? "#222" : "#999", marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.partner_name ? t.partner_name + "さん" : "未設定"}</span>
                  <span onClick={(ev)=>{ ev.stopPropagation(); openPhaseInfo(phase); }} role="button" style={{ display:"block", fontSize:9, fontWeight:700, color:phaseColor, marginTop:1, cursor:"pointer" }}>{APP_PHASE_LABEL[phase]}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {/* ═══ 最終確認（画面内・ページ遷移しない） ═══
          OKを押した時だけ confirm_terms が走る。ここに出す情報は「後戻りできない判断」に必要なものだけ */}
      {confirmItem && (() => {
        const t = confirmItem;
        return (
          <div onClick={()=>{ if (!hiring) setConfirmItem(null); }} className="cb-lock-scroll"
            style={{ position:"fixed", inset:0, zIndex:9200, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
            <div onClick={ev=>ev.stopPropagation()} style={{ width:"100%", maxWidth:420, maxHeight:"86vh", overflowY:"auto", background:"#fff", borderRadius:18, padding:"20px 18px calc(18px + env(safe-area-inset-bottom, 0px))", animation:"cbPop .18s ease" }}>
              <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", textAlign:"center", margin:"0 0 4px" }}>最終確認</p>
              <p className="f-sans" style={{ fontSize:12, color:"#717171", textAlign:"center", margin:"0 0 14px" }}>面接を終えてから決めてください</p>
              <div style={{ display:"flex", alignItems:"center", gap:12, background:"#F7F7F7", borderRadius:12, padding:"12px 14px", marginBottom:12 }}>
                <Avatar url={t.partner_avatar} name={t.partner_name || "？"} size={48} ring={phaseColor} bg={ROLE_ORANGE} />
                <div style={{ minWidth:0 }}>
                  <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>{t.partner_name ? t.partner_name + "さん" : "この方"}</p>
                  <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"3px 0 0", overflow:"hidden", textOverflow:"ellipsis" }}>{titleOf(t)} <span style={{ color:"#999" }}>#{t.job_number}</span></p>
                  <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"2px 0 0" }}>📅 {dateOf(t)}{t.work_time ? "　🕒" + t.work_time : ""}</p>
                </div>
              </div>
              {/* 二重予約の警告（応募者シートと同じ判定＝lib/hire）。下調べ中はその旨を出す＝
                  「警告が無い」のか「まだ調べ終わっていない」のかを取り違えさせない */}
              {t.checking ? (
                <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 10px" }}>日程の重なりを確認中<Dots /></p>
              ) : t.dup ? (
                <p className="f-sans" style={{ fontSize:12, color:"#B54A0E", background:"#FFF6EE", border:"1px solid #F3D3B5", borderRadius:10, padding:"10px 12px", lineHeight:1.7, margin:"0 0 10px" }}>{doubleBookingWarning(t.dup)}</p>
              ) : null}
              {/* 契約成立＝本名の相互開示の明示（2026-07-30たきと裁定(B)・採用confirmに必ず入れる） */}
              <p className="f-sans" style={{ fontSize:12, color:"#555", background:"#F7F7F7", borderRadius:10, padding:"10px 12px", lineHeight:1.7, margin:"0 0 16px" }}>{HIRE_NAME_DISCLOSURE_NOTE}</p>
              <div style={{ display:"grid", gap:8 }}>
                <button onClick={runHire} disabled={hiring || t.checking} className="f-sans"
                  style={{ padding:"13px", fontSize:15, fontWeight:800, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity: (hiring || t.checking) ? 0.5 : 1 }}>
                  {hiring ? <>採用しています<Dots /></> : "OK（採用する）"}
                </button>
                <button onClick={()=>setConfirmItem(null)} disabled={hiring} className="f-sans"
                  style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>やめる</button>
              </div>
              {/* 決める前に見る導線（2026-08-19）：要約ボックスを廃止したので、その役目をここに引き継ぐ。
                  後戻りできない判断の前に、やり取りと応募者の中身を見に行ける道を必ず残す */}
              <div style={{ display:"flex", justifyContent:"center", gap:16, marginTop:14 }}>
                <button onClick={()=>{ if (hiring) return; window.location.hash = "/chat/" + t.application_id; }} className="f-sans"
                  style={{ background:"none", border:"none", padding:0, fontSize:12, fontWeight:700, color:"#00A86B", cursor:"pointer", textDecoration:"underline" }}>チャットを見る</button>
                <button onClick={()=>{ if (hiring) return; markHireSheet(t.application_id); window.location.hash = HIRE_SHEET_PATH; }} className="f-sans"
                  style={{ background:"none", border:"none", padding:0, fontSize:12, fontWeight:700, color:"#717171", cursor:"pointer", textDecoration:"underline" }}>応募者ページで詳しく見る</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ 採用アニメーション（2026-08-06たきと指示） ═══
          「採用」の判子が押印のように現れ、輪が広がり、光の粒が弾ける。人生の節目（契約成立）を祝う一拍。
          人数に達して他の応募が見送りになった時だけ、読み落とさないよう閉じるまで残す */}
      {done && (() => {
        const auto = !done.extra;
        return (
          <div onClick={closeDone} className="cb-lock-scroll"
            style={{ position:"fixed", inset:0, zIndex:9300, background:"rgba(255,255,255,0.96)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24, animation:"fadeIn .2s ease" }}>
            <div style={{ position:"relative", width:180, height:180, display:"flex", alignItems:"center", justifyContent:"center" }}>
              {[0, 1, 2].map(i => (
                <span key={i} aria-hidden style={{ position:"absolute", width:110, height:110, borderRadius:"50%", border:"3px solid #00A86B", animation:`cbHireRing 1.5s ease-out ${0.15 + i * 0.28}s both` }} />
              ))}
              {/* 飛び散る光の粒（2026-08-19：🌾✨🌸の絵文字から差し替え）＝絵ではなく光。
                  大小を交互にして、単調な点の輪に見えないようにする */}
              {Array.from({ length: 12 }).map((_, i) => {
                const a = (i / 12) * Math.PI * 2;
                const d = i % 2 === 0 ? 9 : 6;
                return (
                  <span key={"b" + i} aria-hidden style={{ position:"absolute", width:d, height:d, borderRadius:"50%", background:"#00A86B", ["--dx"]: Math.cos(a) * 92 + "px", ["--dy"]: Math.sin(a) * 92 + "px", animation:`cbHireBurst 1.1s ease-out ${0.2 + (i % 4) * 0.06}s both` }} />
                );
              })}
              {/* 印そのものも文字にする（2026-08-19：🤝から差し替え）＝丸い枠に「採用」を彫った判子 */}
              <span className="f-sans" aria-hidden style={{ width:118, height:118, borderRadius:"50%", border:"5px solid #00A86B", color:"#00A86B",
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:34, fontWeight:900, letterSpacing:".08em",
                animation:"cbHireSeal .7s cubic-bezier(.2,1.3,.4,1) both" }}>採用</span>
            </div>
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#00A86B", margin:"8px 0 0", animation:"cbHireText .5s ease .45s both" }}>採用しました</p>
            <p className="f-sans" style={{ fontSize:13, color:"#555", lineHeight:1.8, textAlign:"center", margin:"8px 0 0", animation:"cbHireText .5s ease .6s both" }}>
              {done.name ? done.name + "さん" : "応募者"}と #{done.jobNumber} の契約が成立しました。<br />作業日などの連絡はチャットでどうぞ。
            </p>
            {done.extra && (
              <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.8, textAlign:"center", maxWidth:380, background:"#F7F7F7", borderRadius:10, padding:"10px 12px", margin:"14px 0 0", animation:"cbHireText .5s ease .7s both" }}>{done.extra}</p>
            )}
            {auto ? <AutoClose onDone={closeDone} /> : (
              <button onClick={closeDone} className="f-sans"
                style={{ marginTop:18, padding:"11px 26px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", animation:"cbHireText .5s ease .8s both" }}>閉じる</button>
            )}
          </div>
        );
      })()}
    </>
  );
}

// 演出を一定時間で自動的に閉じる（タップでも閉じられる）。※モジュールレベル定義を維持すること
function AutoClose({ onDone, ms = 2600 }) {
  // 呼び出し側が毎回新しい関数を渡してもタイマーを張り直さない（refに最新を持たせる）
  const cb = useRef(onDone); cb.current = onDone;
  useEffect(() => { const id = setTimeout(() => cb.current?.(), ms); return () => clearTimeout(id); }, [ms]);
  return null;
}

// 仕事の評価ページ（#/calendar/todo/w_review・2026-08-19たきと指示
// 「探すページの求人一覧と同じ構造に。タップで、終了の確認・評価ボックス展開」）：
// ★カードは JobCard variant="wide" ＝関連求人と同じ「写真に情報を重ねる」型（2026-08-19たきと訂正）。
//   関連(related)は横スクロール用に幅280px固定so、縦一列のこの面には全幅版の wide を使う
//   （wide＝「関連カードと同じ型を全幅で」・ステータスページの展開ボックスと同じ）。
//   似せて描かない＝JobCardを直せばこの面も自動で追従する。
// 材料は jobs_public（open/closedを含む）から job_number でまとめて引く。my_todo_items は
// 写真も報酬も返さないため。引けなかった求人（行that消えた等）は最小のカードで出す＝一覧から落とさない。
// タップ→終了の確認・評価（共有部品 WorkerReviewSheet＝応募状況ページと同じ入力・同じ保存）。
// ★モジュールレベル定義を維持すること（親内定義はフォーカス消失バグの元）
export function ReviewStagePanel({ items, meId, onReviewed }) {
  // ★viewCacheには入れない：mapJobPublicRow の dateStart/dateEnd は Date オブジェクトso、
  //   JSONで保存→復元すると文字列になり読む側that落ちる（2026-08-03の実害と同じ型）。
  //   この面は開いた時に1往復するだけso、素直に毎回引く
  const [jobs, setJobs] = useState({}); // job_number → mapJobPublicRow
  const [reviewApp, setReviewApp] = useState(null); // 展開中の 終了の確認・評価
  const [done, setDone] = useState(null);           // 送信できた祝祭（演出のみ）
  const numsKey = items.map(t => t.job_number).filter(Boolean).join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nums = numsKey ? numsKey.split(",").map(Number) : [];
      if (!nums.length) return;
      try {
        const { data, error } = await fetchPublicJobsByNumbers(nums);
        // 失敗時は手元の値を上書きしない（2026-08-07フェイルオープン規則）
        if (cancelled || error || !data) return;
        setJobs(prev => {
          const nx = { ...prev };
          data.forEach(r => { nx[r.job_number] = mapJobPublicRow(r); });
          return nx;
        });
      } catch { /* 取得できなくてもカードは最小形で出す */ }
    })();
    return () => { cancelled = true; };
  }, [numsKey]);
  return (
    <>
      {/* 縦一列（関連求人と同じ型のカードを全幅で並べる） */}
      <div style={{ display:"grid", gap:16 }}>
        {items.map(t => {
          const job = jobs[t.job_number];
          const open = () => setReviewApp({ id: t.application_id, farmer_id: t.partner_id });
          if (job) {
            // onOpen＝タップの行き先をこの面に預ける（新しいタブで求人詳細を開かない）
            return <JobCard key={t.application_id} job={job} variant="wide" onOpen={open} hideEndLabel />;
          }
          // 求人の情報that引けなかった時（掲載の行that無い等）：作物×作業と#No.だけの最小カード
          return (
            <button key={t.application_id} onClick={open} className="f-sans"
              style={{ display:"block", width:"100%", textAlign:"left", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px 14px", cursor:"pointer" }}>
              <span style={{ display:"block", fontSize:15, fontWeight:700, color:"#222" }}>{[t.crop, t.task].filter(Boolean).join(" ") || "求人"}</span>
              <span style={{ display:"block", fontSize:12, color:"#999", marginTop:2 }}>#{t.job_number}</span>
            </button>
          );
        })}
      </div>
      <WorkerReviewSheet app={reviewApp} meId={meId}
        onClose={()=>setReviewApp(null)}
        onDone={(id)=>{ setReviewApp(null); setDone({ title:"ありがとうございました" }); onReviewed(id); }} />
      {done && <Celebration title={done.title} onDone={()=>setDone(null)} />}
    </>
  );
}

// 今日の記録ページ（#/calendar/todo/day_report・#/calendar/todo/w_day_report・2026-08-19たきと指示
// 「最終日だけ全体的な評価。それ以外は遅刻や欠勤、農家が来ていないとかの入力にする」）：
// 最終作業日より前の作業日は、評価の代わりにこの記録が並ぶ。並べ方は仕事の評価ページと同じ
// （さがすと同じ求人カード＋タップでその場に入力シート）＝役割で画面の骨を変えない。
// 入力と保存は共有部品 DayReportSheet（緊急連絡のシートと同じもの）。
// ★片付いても箱からは消さない：記録は「何か起きた時だけ」つけるものので、1件つけたら
//   その日の用事が終わる、とは限らない（遅刻の後に早退、もある）。祝祭も出さない（祝う場面ではない）。
// ★モジュールレベル定義を維持すること（親内定義はフォーカス消失バグの元）
export function DayReportPanel({ items, meId, role }) {
  // ★viewCacheには入れない：mapJobPublicRow の dateStart/dateEnd は Date オブジェクトので、
  //   JSONで保存→復元すると文字列になり読む側が落ちる（2026-08-03の実害と同じ型）
  const [jobs, setJobs] = useState({});
  const [reportApp, setReportApp] = useState(null);
  const [sentIds, setSentIds] = useState(() => new Set()); // この画面で記録できたもの（控えめな既済み表示）
  const numsKey = items.map(t => t.job_number).filter(Boolean).join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nums = numsKey ? numsKey.split(",").map(Number) : [];
      if (!nums.length) return;
      try {
        const { data, error } = await fetchPublicJobsByNumbers(nums);
        // 失敗時は手元の値を上書きしない（2026-08-07フェイルオープン規則）
        if (cancelled || error || !data) return;
        setJobs(prev => {
          const nx = { ...prev };
          data.forEach(r => { nx[r.job_number] = mapJobPublicRow(r); });
          return nx;
        });
      } catch { /* 取得できなくてもカードは最小形で出す */ }
    })();
    return () => { cancelled = true; };
  }, [numsKey]);
  const partnerColor = role === "farmer" ? ROLE_ORANGE : ROLE_GREEN;
  return (
    <>
      <div style={{ display:"grid", gap:16 }}>
        {items.map(t => {
          const job = jobs[t.job_number];
          const open = () => setReportApp({ id: t.application_id });
          return (
            <div key={t.application_id} style={{ display:"grid", gap:8 }}>
              {/* 相手（誰についての記録か・誰に届くか）。アイコンは相手の役割色（チャットの役割色枠と同じ規約） */}
              <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
                <Avatar url={t.partner_avatar} name={t.partner_name || "？"} size={32} ring={partnerColor} bg={partnerColor} />
                <span className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {t.partner_name ? t.partner_name + "さん" : "相手"}
                </span>
                {sentIds.has(t.application_id) && (
                  <span className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#E24B4A" }}>記録しました</span>
                )}
              </div>
              {job ? (
                <JobCard job={job} variant="wide" onOpen={open} hideEndLabel />
              ) : (
                <button onClick={open} className="f-sans"
                  style={{ display:"block", width:"100%", textAlign:"left", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px 14px", cursor:"pointer" }}>
                  <span style={{ display:"block", fontSize:15, fontWeight:700, color:"#222" }}>{[t.crop, t.task].filter(Boolean).join(" ") || "求人"}</span>
                  <span style={{ display:"block", fontSize:12, color:"#999", marginTop:2 }}>#{t.job_number}</span>
                </button>
              )}
              <button onClick={open} className="f-sans"
                style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A", borderRadius:10, cursor:"pointer" }}>
                遅刻・欠勤などを記録する
              </button>
            </div>
          );
        })}
      </div>
      <DayReportSheet app={reportApp} meId={meId} role={role}
        onClose={()=>setReportApp(null)}
        onDone={(id)=>{ setReportApp(null); setSentIds(prev => new Set(prev).add(id)); }} />
    </>
  );
}
