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
import { fetchMyFarmJobs, fetchPublicJobsByNumbers } from "../todayApi";
import { getCache, setCache } from "../../../lib/viewCache";
import { calFmtDate, ROLE_ORANGE, ROLE_GREEN, photoThumb, mapJobPublicRow,
  appPhaseKey, phaseLabelNow, phaseColorNow, APP_PHASE_LABEL, APP_PHASE_COLOR, APP_PHASE_DESC, CHAT_ELIGIBLE_STATUSES, appWorkDates, isWorkWindowOpen } from "../../../lib/utils";
import { openPhaseInfo } from "../../../lib/previewBus";
import { Avatar } from "../../../components/ui";
import { HireConfirm, HIRE_SHEET_PATH, markHireSheet } from "../../../components/HireConfirm";
import ContractPartyName from "../../../components/ContractPartyName";
import ContractEmergencyContact from "../../../components/ContractEmergencyContact";
import { JobCard } from "../../../components/JobCard";
import { WorkerReviewSheet } from "../../../components/WorkerReviewSheet";
import { DayReportSheet } from "../../../components/DayReportSheet";
import { Celebration } from "../../../components/Celebration";
import { NavIcon, NavIconInline } from "../../../components/NavIcons";


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
                {photo ? <img src={photo} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : <NavIcon name="image" size={28} style={{ color:"#C8C8C8" }} />}
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
                    {photo ? <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : <NavIcon name="image" size={28} style={{ color:"#C8C8C8" }} />}
                  </div>
                  <div style={{ minWidth:0 }}>
                    <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:0 }}>{titleOf(e)}</p>
                    <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"2px 0 0" }}>#{e.job_number}{e.town ? "　" + e.town : ""}</p>
                    <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}><NavIconInline name="calendar" size={12} style={{ verticalAlign:"-1px" }} />{dateLabel}{e.work_time ? <>　<NavIconInline name="clock" size={12} style={{ verticalAlign:"-1px", marginRight:2 }} />{e.work_time}</> : ""}</p>
                    {e.partner_name && <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"2px 0 0" }}>相手 {e.partner_name}さん</p>}
                  </div>
                </div>
                {/* 契約成立後のみ相手の本名を開示（当事者間・KYC非複製・2026-07-30たきと裁定(B)） */}
                {e.application_id && <ContractPartyName applicationId={e.application_id} showPending={false} style={{ margin:"0 0 12px", paddingLeft:2 }} />}
                {/* 緊急連絡先は【仕事の開始から終了まで】だけ（2026-08-25たきと指示）。
                    このRPCは打刻の列を返さないので application_status（working）で窓を判定する */}
                {e.application_id && <ContractEmergencyContact applicationId={e.application_id} style={{ margin:"0 0 12px" }} workWindow={isWorkWindowOpen(e)} />}
                {/* 操作（ステータスページのボタン群と同じ位置づけ。主役＝緊急連絡） */}
                <div style={{ display:"grid", gap:8 }}>
                  <button onClick={()=>{ setBoxItem(null); setReportApp({ id: e.application_id }); }} className="f-sans"
                    style={{ padding:"12px", fontSize:14, fontWeight:700, background:"#E24B4A", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}><NavIconInline name="alert" size={14} style={{ verticalAlign:"-2.5px" }} />緊急連絡をする</button>
                  {chatOk && (
                    <button onClick={()=>{ setBoxItem(null); window.location.hash = "/chat/" + e.application_id; }} className="f-sans"
                      style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}><NavIconInline name="chats" size={13} style={{ verticalAlign:"-2px" }} />チャットを開く</button>
                  )}
                  {/* 戻り先＝この緊急連絡ページ（旧 "/calendar" は今日ページ廃止でマイページ行きになるため・2026-08-22） */}
                  <button onClick={()=>{ setBoxItem(null); try { sessionStorage.setItem("cb_jobBackTo", "/calendar/todo/t_emergency"); } catch {} window.location.hash = "/work/job/" + e.job_number; }} className="f-sans"
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
// 遷移の合図は共有部品（components/HireConfirm）に移した。ここは従来の輸出口を保つための再輸出
export { HIRE_SHEET_PATH, markHireSheet };

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
  // 最終確認を開く＝共有部品に応募を渡すだけ（二重予約の下調べ・実行・演出はあちらが持つ）
  const openConfirm = (t) => setConfirmItem(t);
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
                {photo ? <img src={photo} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : <NavIcon name="image" size={28} style={{ color:"#C8C8C8" }} />}
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
      {/* 最終確認＋実行＋祝いの演出は共有部品（2026-08-28）＝応募者ページ・求人カードと同じもの。
          ★ここで confirm_terms を自前に撃たない（判定・文言・実行を1箇所に保つ） */}
      <HireConfirm app={confirmItem} meId={meId}
        onClose={()=>setConfirmItem(null)}
        onHired={(id)=>{ setHiredIds(prev => new Set(prev).add(id)); if (onHired) onHired(id); }} />
    </>
  );
}

// 仕事の評価ページ（#/calendar/todo/w_review・2026-08-19たきと指示
// 「探すページの求人一覧と同じ構造に。タップで、終了の確認・評価ボックス展開」）：
// ★カードは JobCard variant="wide" ＝関連求人と同じ「写真に情報を重ねる」型（2026-08-19たきと訂正）。
//   関連(related)は横スクロール用に幅280px固定so、縦一列のこの面には全幅版の wide を使う
//   （wide＝「関連カードと同じ型を全幅で」・ステータスページの展開ボックスと同じ）。
//   似せて描かない＝JobCardを直せばこの面も自動で追従する。
// 材料は jobs_public（open/closedを含む）から job_number でまとめて引く。my_todo_items は
// 写真も報酬も返さないため。引けなかった求人（行が消えた等）は最小のカードで出す＝一覧から落とさない。
// タップ→終了の確認・評価（共有部品 WorkerReviewSheet＝応募状況ページと同じ入力・同じ保存）。
// ★モジュールレベル定義を維持すること（親内定義はフォーカス消失バグの元）
export function ReviewStagePanel({ items, meId, onReviewed }) {
  // ★viewCacheには入れない：mapJobPublicRow の dateStart/dateEnd は Date オブジェクトso、
  //   JSONで保存→復元すると文字列になり読む側が落ちる（2026-08-03の実害と同じ型）。
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
          // 実働日数（客観データの見出し用）。求人票の休日は jobs_public の行があれば反映
          const open = () => setReviewApp({ id: t.application_id, farmer_id: t.partner_id,
            dayCount: appWorkDates(t, { date_start: t.date_start, date_end: t.date_end, holidays: job?.holidays }).size || null });
          if (job) {
            // onOpen＝タップの行き先をこの面に預ける（新しいタブで求人詳細を開かない）
            // ★黒の枠線（2026-08-19たきと指示）は包みで描く＝JobCard（枠なしカード）は触らない。
            //   写真の角丸(16)と同じ半径＋overflow:hidden so、写真の角が枠から出ない
            return (
              <div key={t.application_id} style={{ border:"1.5px solid #222", borderRadius:16, overflow:"hidden" }}>
                <JobCard job={job} variant="wide" onOpen={open} hideEndLabel />
              </div>
            );
          }
          // 求人の情報が引けなかった時（掲載の行が無い等）：作物×作業と#No.だけの最小カード
          return (
            <button key={t.application_id} onClick={open} className="f-sans"
              style={{ display:"block", width:"100%", textAlign:"left", background:"#fff", border:"1.5px solid #222", borderRadius:16, padding:"16px 14px", cursor:"pointer" }}>
              <span style={{ display:"block", fontSize:15, fontWeight:700, color:"#222" }}>{[t.crop, t.task].filter(Boolean).join(" ") || "求人"}</span>
              <span style={{ display:"block", fontSize:12, color:"#999", marginTop:2 }}>#{t.job_number}</span>
            </button>
          );
        })}
      </div>
      <WorkerReviewSheet app={reviewApp} meId={meId} dayCount={reviewApp?.dayCount || null}
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
