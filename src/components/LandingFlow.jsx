// 分割3-C（2026-07-25）：App.jsxから移動。求人作成フロー全体（農家・働き手の入口〜確認〜完了）。
// 専用ヘルパー（geocodeTown/compressImage/normalizePhotos/dangerHasSecond/LF系UI部品/最賃チェック）も同居。
// LF系UI部品はモジュールレベル定義を維持すること（コンポーネント内定義はフォーカス消失バグの原因）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { fbCelebrate } from "../lib/feedback";
import { zipLookup } from "../lib/zipLookup";
import { uploadJobPhoto } from "../lib/image";
import { isAdmin, ymdLocal, CROP_OPTIONS, TASK_OPTIONS, EMPTY_MARK, stationLabel, farmHostQa, farmIntroTopics, perkBadges, PUBLISH_CHECKS, payTermsLine, CURRENT_PAY_POLICY, OVERTIME_OPTIONS, overtimeLine, photoThumb, splitTextsForReview } from "../lib/utils";
import { getCache, setCache } from "../lib/viewCache";
import { snapGet } from "../lib/snapshot";
import { Avatar, DangerItem, JobFlagBadges, JobPhotoFallback, LFPillSelect, LFWizCard, LFCardBtn, LFCropGrid, LFSummaryRow, DevBadge, LinkifiedText, QaChat } from "./ui";
import { CalendarView } from "./CalendarView";
import { JobLocationMap } from "./JobLocationMap";
import { ContentQTabs, ContentQSwipeArea, JobQuestions } from "./JobQuestions";
import { InsurancePanel } from "./InsurancePanel";
import { FarmerTrustCard } from "./TrustCards";
import { EmployerProfileEdit } from "./EmployerProfileEdit";
import { JobSearchMapView } from "./JobSearchMapView";

// 国土地理院 住所検索API（APIキー不要・無料）
// 町域レベルの重心を返す。番地を渡してはならない。
async function geocodeTown(prefecture, city, town) {
  const q = `${prefecture || ""}${city || ""}${town || ""}`.trim();
  if (!q) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(
      "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(q),
      { signal: ctrl.signal }
    );
    if (!res.ok) return null;
    const features = await res.json();
    if (!Array.isArray(features) || features.length === 0) return null;

    // 検索語で始まる結果のみを採用する（無関係な一致を排除）
    const hits = features.filter(f => (f?.properties?.title || "").startsWith(q));
    const use = hits.length > 0 ? hits : features;

    // 全点の重心を取る（先頭1件を採用しない）
    const pts = use
      .map(f => f?.geometry?.coordinates)
      .filter(c => Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (pts.length === 0) return null;

    const lng = pts.reduce((s, c) => s + c[0], 0) / pts.length;
    const lat = pts.reduce((s, c) => s + c[1], 0) / pts.length;

    // 重心から最も遠い点までの距離を半径にする（町域の広がりを円が覆う）
    // 緯度1度≒111km、経度1度≒111km×cos(緯度)
    const mPerLat = 111000;
    const mPerLng = 111000 * Math.cos((lat * Math.PI) / 180);
    let maxDist = 0;
    for (const c of pts) {
      const dx = (c[0] - lng) * mPerLng;
      const dy = (c[1] - lat) * mPerLat;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxDist) maxDist = d;
    }
    // 最小500m・最大3000mに収める（1点しか返らない場合の下限を確保）
    const radius = Math.round(Math.min(Math.max(maxDist, 500), 3000));

    return { lat, lng, radius, from: q };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// compressImage（アップロード前のクライアント圧縮）は lib/image.js へ移動（2026-07-26・ヘルプのスクショと共用化）

// 写真配列の正規化（2026-07-16）：旧形式（"url"文字列）が混ざると確認ページ等の p.url が
// undefined になり真っ白なスライドが出るため、復元・再開の境界で必ず {url, caption} に揃える。
// url の無い壊れた要素は除外する
function normalizePhotos(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map(p => (typeof p === "string" ? { url: p } : p))
    .filter(p => p && typeof p.url === "string" && p.url.trim());
}

// 危険項目の2つ目に中身（タイトル・説明・写真）があるか（2026-07-16）。
// 復元時にshowPlace2/showTask2を立てないと、2つ目がstep9で見えないまま確認ページに残り続ける
function dangerHasSecond(arr) {
  const x = Array.isArray(arr) ? arr[1] : null;
  return !!(x && (((x.label || "").trim()) || ((x.desc || "").trim()) || ((x.photos || []).length > 0)));
}

// ── LandingFlow 共有UIヘルパー（モジュールレベル定義でフォーカス消失バグを防ぐ）───
// 注意：これらを LandingFlow 内に定義すると再レンダリングのたびに関数参照が変わり
// React が別コンポーネントと判定してアンマウントし input のフォーカスが失われる。

// 写真並び替えストリップ（2026-08-03たきと指示「長押しでスワイプ。タップ機能削除せず」）：
// ◀▶タップは従来どおり。加えてサムネを長押し（350ms・動かさず）するとドラッグモードに入り、
// 指を左右に動かすと通過したサムネの位置へ入れ替わる。離すと確定。
// ・長押し前に10px以上動いたら長押し取消＝従来の横スクロールに譲る（スクロールと衝突しない）
// ・【重要・2026-08-03修理】タッチの追従は native touchmove で行う（pointermoveに頼らない）。
//   pointermove方式は「長押しはできるが動かない」で失敗した。原因は3つ：
//   (1) 長押し後に指を動かすとブラウザがスクロール判定して pointercancel を飛ばし、
//       それでドラッグを終了していた（pointercancelでは終了しない設計に変更）
//   (2) touchmoveをpreventDefaultすると pointermove の配送が止まる実装がある
//   (3) touch-action は指を置いた時点の値で決まるso、長押し成立後に none にしても遅い
//   長押しは350ms静止が条件＝成立時点でスクロールは未開始so、その後のtouchmoveは
//   cancelable＝preventDefaultでスクロールを止められる（TodayPage横スワイプと同じ技法）
// ・端に近づいたらストリップを自動スクロール（はみ出した写真へも運べる）
function LFPhotoReorderStrip({ photos, setPhotos }) {
  const [dragIdx, setDragIdx] = useState(null);
  const dragIdxRef = useRef(null);
  const stripRef = useRef(null);
  const pressTimer = useRef(null);
  const startPos = useRef({ x: 0, y: 0 });
  const moveRef = useRef(null); // 最新のhandleDragMove（[]依存のnativeリスナーから呼ぶため）
  const cancelPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };
  const movePhoto = (i, dir) => setPhotos(prev => { const j = i + dir; if (j < 0 || j >= prev.length) return prev; const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next; });
  const endDrag = () => { cancelPress(); if (dragIdxRef.current != null) { dragIdxRef.current = null; setDragIdx(null); } };

  const handleDragMove = (clientX) => {
    const strip = stripRef.current;
    if (!strip || dragIdxRef.current == null) return;
    // 端の自動スクロール（±36px圏内）
    const sr = strip.getBoundingClientRect();
    if (clientX < sr.left + 36) strip.scrollLeft -= 10;
    else if (clientX > sr.right - 36) strip.scrollLeft += 10;
    // 指に一番近いサムネ（中心との距離）へ移動。ドラッグ中の札はscale(1.1)で広がるため、
    // 「範囲に入ったか」でなく「中心が最も近いか」で判定する（重なりでの取りこぼしを防ぐ）
    const kids = Array.from(strip.children);
    let best = -1, bestD = Infinity;
    for (let k = 0; k < kids.length; k++) {
      const r = kids[k].getBoundingClientRect();
      const d = Math.abs(clientX - (r.left + r.width / 2));
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best >= 0 && best !== dragIdxRef.current) {
      const from = dragIdxRef.current;
      setPhotos(prev => { const next = [...prev]; const [it] = next.splice(from, 1); next.splice(best, 0, it); return next; });
      dragIdxRef.current = best;
      setDragIdx(best);
    }
  };
  moveRef.current = handleDragMove;

  // タッチ：追従・スクロール抑止・終了をすべてnativeイベントで完結させる（passive:false）
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onTouchMove = (e) => {
      const t = e.touches[0];
      if (!t) return;
      if (dragIdxRef.current == null) {
        // 長押し成立前に動いた＝スクロール意図so長押しを取消（pointermoveが来ない端末の保険）
        if (pressTimer.current && (Math.abs(t.clientX - startPos.current.x) > 10 || Math.abs(t.clientY - startPos.current.y) > 10)) cancelPress();
        return;
      }
      if (e.cancelable) e.preventDefault(); // ドラッグ中は画面・ストリップのスクロールを止める
      moveRef.current?.(t.clientX);
    };
    const onTouchEnd = () => endDrag();
    strip.addEventListener("touchmove", onTouchMove, { passive: false });
    strip.addEventListener("touchend", onTouchEnd);
    strip.addEventListener("touchcancel", onTouchEnd);
    return () => {
      strip.removeEventListener("touchmove", onTouchMove);
      strip.removeEventListener("touchend", onTouchEnd);
      strip.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // マウス（PC）：window で pointermove を追う。pointercancelでは終了しない
  // （タッチのスクロール判定でcancelが飛ぶため。タッチの終了はtouchend/touchcancelが担う）
  useEffect(() => {
    if (dragIdx == null) return;
    const onMove = (e) => { if (e.pointerType !== "touch") moveRef.current?.(e.clientX); };
    const onUp = () => endDrag();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelPress(), []); // アンマウント時にタイマー掃除

  return (
    <div>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 8px" }}>写真の並び替え（先頭が求人カードの表紙になります）。◀▶か、長押しして指で動かしても並び替えできます</p>
      <div ref={stripRef} style={{ display:"flex", gap:10, overflowX:"auto", paddingBottom:4, WebkitOverflowScrolling:"touch" }}>
        {photos.map((p, i) => (
          <div key={i} style={{ flexShrink:0, width:76 }}>
            <div
              onPointerDown={(e) => {
                if (e.pointerType === "mouse" && e.button !== 0) return;
                startPos.current = { x: e.clientX, y: e.clientY };
                cancelPress();
                pressTimer.current = setTimeout(() => {
                  pressTimer.current = null;
                  dragIdxRef.current = i;
                  setDragIdx(i);
                  try { navigator.vibrate?.(10); } catch {}
                }, 350);
              }}
              onPointerMove={(e) => {
                // 長押し成立前に動いたら取消＝スクロール意図（成立後の追従はtouchmove／window pointermoveが担う）
                if (dragIdxRef.current == null && pressTimer.current) {
                  if (Math.abs(e.clientX - startPos.current.x) > 10 || Math.abs(e.clientY - startPos.current.y) > 10) cancelPress();
                }
              }}
              onPointerUp={cancelPress}
              /* pointercancelでは【ドラッグを終了しない】（タッチのスクロール判定で飛ぶため。
                 これで終了していたのが「長押しできるが動かない」の主因）。タイマー掃除だけ行う */
              onPointerCancel={cancelPress}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                position:"relative", width:76, height:76, borderRadius:8, overflow:"hidden",
                border: dragIdx === i ? "2px solid #00A86B" : i === 0 ? "2px solid #00A86B" : "1px solid #EBEBEB",
                transform: dragIdx === i ? "scale(1.1)" : "none",
                boxShadow: dragIdx === i ? "0 6px 16px rgba(0,0,0,0.25)" : "none",
                transition: "transform .12s ease, box-shadow .12s ease",
                zIndex: dragIdx === i ? 2 : 1,
                touchAction: dragIdx != null ? "none" : undefined,
                WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none",
              }}
            >
              <img loading="lazy" draggable={false} src={photoThumb(p)} alt={`写真${i + 1}`} style={{ width:"100%", height:"100%", objectFit:"cover", pointerEvents:"none" }} />
              {i === 0 && <span className="f-sans" style={{ position:"absolute", top:4, left:4, fontSize:9, fontWeight:700, color:"#fff", background:"#00A86B", borderRadius:6, padding:"1px 5px" }}>表紙</span>}
            </div>
            <div style={{ display:"flex", gap:4, marginTop:4 }}>
              <button onClick={() => movePhoto(i, -1)} disabled={i === 0} aria-label="前へ" className="f-sans" style={{ flex:1, padding:"6px 0", fontSize:13, fontWeight:700, background:"#fff", color: i === 0 ? "#D0D0D0" : "#00A86B", border:"1px solid #EBEBEB", borderRadius:6, cursor: i === 0 ? "default" : "pointer" }}>◀</button>
              <button onClick={() => movePhoto(i, 1)} disabled={i === photos.length - 1} aria-label="次へ" className="f-sans" style={{ flex:1, padding:"6px 0", fontSize:13, fontWeight:700, background:"#fff", color: i === photos.length - 1 ? "#D0D0D0" : "#00A86B", border:"1px solid #EBEBEB", borderRadius:6, cursor: i === photos.length - 1 ? "default" : "pointer" }}>▶</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LFMultiPill({ options, values, onToggle }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:8 }}>
      {options.map(o => {
        const sel = values.includes(o);
        return (
          <button key={o} onClick={() => onToggle(o)} className="f-sans" style={{
            padding:"7px 14px", borderRadius:20, fontSize:12, cursor:"pointer", fontWeight:600, border:"2px solid",
            borderColor: sel ? "#00A86B" : "#EBEBEB",
            background: sel ? "#E6F7EF" : "#fff", color: sel ? "#00A86B" : "#222",
          }}>{o}</button>
        );
      })}
    </div>
  );
}
// サービス提供範囲。展開時はこの配列に都道府県を追加するだけでよい
const ALLOWED_PREFECTURES = ["徳島県"];
const isAllowedPrefecture = (pref) => ALLOWED_PREFECTURES.includes((pref || "").trim());

// 時給・日給が最低賃金を下回っていないかを判定する純関数
// workHours: 勤務時間（終了時刻 - 開始時刻、時間単位）。breakMinutes: 申告休憩（分）。
// 実働 = 拘束 − greatest(申告休憩, 法定最低休憩)。法定最低休憩＝拘束6時間超45分・8時間超60分（労基法34条）。
// ★DBの掲載トリガー（trg_job_publish_snapshot・migration 20260806163552）と同じ式。片方だけ変えないこと
function validateMinWage(hourly, daily, workHours, minWage, breakMinutes = 0) {
  // 最低賃金が取得できていない場合は検証不能。安全側に倒して掲載を止める
  if (!minWage || minWage <= 0) {
    return { hourlyViolation: hourly > 0, dailyViolation: daily > 0, unknownWage: true };
  }
  const hourlyViolation = hourly > 0 && hourly < minWage;
  let dailyViolation = false;
  if (daily > 0 && workHours > 0) {
    const legalBreakHours = workHours > 8 ? 1 : workHours > 6 ? 0.75 : 0;
    const breakHours = Math.max(breakMinutes / 60, legalBreakHours);
    const actualHours = workHours - breakHours;
    if (actualHours <= 0 || daily / actualHours < minWage) dailyViolation = true;
  }
  return { hourlyViolation, dailyViolation, unknownWage: false };
}

function LFWageNote() {
  return (
    <div style={{ padding:"8px 12px", background:"#FEF3E2", borderRadius:8, border:"1px solid #F5A62333", marginTop:8 }}>
      <p className="f-sans" style={{ fontSize:11, color:"#F5A623" }}>⚠ 報酬は最低賃金を下回らないように設定してください</p>
    </div>
  );
}
// LFPrivacyNote（本名・電話番号・詳細住所は初期表示しません…）は全廃（2026-08-08たきと指示
// 「削除。何度も警告しているよね？」）：同じ警告が複数ページで繰り返されていた。
// 公開範囲の事実の説明は step3「集合場所の公開範囲とは？」に一本化済み
function LFWageCompare({ type, value, avg, count }) {
  if (!value || value <= 0) return null;
  const median = Math.round(avg * 0.97);
  if (count < 5) return <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:6 }}>まだ同条件のデータが少ないため、平均は表示できません。</p>;
  const diff = value - avg;
  return (
    <div style={{ marginTop:8, padding:"10px 12px", background:"#F7F7F7", borderRadius:8 }}>
      <p className="f-sans" style={{ fontSize:11, color:"#717171" }}>
        この経歴・作業内容の平均{type}：<span className="f-mono" style={{ fontWeight:700, color:"#222" }}>{avg.toLocaleString()}円</span>　中央値：{median.toLocaleString()}円　件数：{count}件
      </p>
      <p className="f-sans" style={{ fontSize:11, fontWeight:600, marginTop:4, color: diff >= 0 ? "#00A86B" : "#F5A623" }}>
        あなたの希望{type}：{value.toLocaleString()}円　平均より {diff >= 0 ? "+" : ""}{diff.toLocaleString()}円{diff < 0 ? "（応募が集まりにくい可能性があります）" : ""}
      </p>
    </div>
  );
}
function LFFakeFilterRow() {
  return (
    <div style={{ display:"flex", gap:6, marginBottom:12, overflowX:"auto", scrollbarWidth:"none" }}>
      {["地域","作物","作業","日付","経験","報酬","移動手段"].map(f => (
        <span key={f} style={{ flexShrink:0, padding:"6px 12px", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:11, color:"#717171" }}>{f}</span>
      ))}
    </div>
  );
}

// ── LandingFlow ──────────────────────────────────────────────
// 表示条件：{!me && showLanding && <LandingFlow .../>} — 未ログイン訪問者に表示
export function LandingFlow({ onComplete, onSkip, onLogin, onPublished, onWorkerDone, farmersCount = 0, embedded = false, initialRole = "", onStepChange, initialStep }) {
  const AVG_HOURLY = 1180, AVG_DAILY = 8400, AVG_COUNT = 0;

  // ── ログイン後復帰: postLoginReturnTo を確認して draft を読み込む ──
  const _draftInit = (() => {
    try {
      // 復元条件：①ログイン往復フラグ ②URLが求人フロー(#/work/new*)のままのリロード（2026-07-14追加）
      // ②が無いと、確認ページ等でリロードした際に入力が全て白紙に戻る（stateは復元されずURLだけ残る）
      const _h = window.location.hash.replace(/^#\/?/, "");
      const _inNewJobFlow = _h === "work/new" || _h.startsWith("work/new/");
      if (localStorage.getItem('postLoginReturnTo') === 'landingFlowFarmerConfirm' || _inNewJobFlow) {
        const d = JSON.parse(localStorage.getItem('landingFlowDraft_v1') || '{}');
        if (d.role === 'farmer') return d;
      }
    } catch {}
    return null;
  })();

  const _devJump = (() => { try { return JSON.parse(localStorage.getItem('devJump')||'null'); } catch { return null; } })();

  const _editJobNumber = (() => { const m = window.location.hash.replace(/^#\/?/,"").match(/^work\/edit\/(\d+)$/); return m ? parseInt(m[1],10) : null; })();
  const [role, setRole] = useState(_devJump?.role ?? _draftInit?.role ?? (_editJobNumber ? "farmer" : null) ?? initialRole ?? ""); // "" | "farmer" | "worker"
  // 編集・コピー（#/work/edit/{n}）は確認ページ(11)から始める（2026-08-03）。
  // 初期値が0（入口）だと、jobsを読み終えるまで「はじめから」の画面が見えてしまう。
  // 実際のstepは読み込み後に draft_step で上書きされる（copy_jobも draft_step=11 で作る）
  const [step, setStep] = useState((initialStep && initialStep >= 1 && initialStep <= 11) ? initialStep : (_devJump?.step ?? (_draftInit ? (_draftInit.farmerStep ?? 1) : (_editJobNumber ? 11 : 0)))); // URL(#/work/new/{step})最優先→devJump→draft→編集は11→0

  // 農家 state（draft がある場合は復元値を初期値に使う）
  const d = _draftInit || {};
  const [farmerExp,         setFarmerExp]         = useState(d.farmerExp ?? "");
  const [farmerPurpose,     setFarmerPurpose]     = useState(_devJump?.farmerPurpose ?? d.farmerPurpose ?? "post");
  const [farmerDisplayName, setFarmerDisplayName] = useState(d.farmerDisplayName ?? "");
  const [farmerRegion,      setFarmerRegion]      = useState(d.farmerRegion ?? "");
  // 住所4分割（段階1。郵便番号自動検索・地図・新規登録からの引き継ぎは将来）
  const [farmerZip,         setFarmerZip]         = useState(d.farmerZip ?? "");
  const [farmerPref,        setFarmerPref]        = useState(d.farmerPref ?? "");
  const [farmerCity,        setFarmerCity]        = useState(d.farmerCity ?? "");
  const [farmerTown,        setFarmerTown]        = useState(d.farmerTown ?? "");
  const [farmerAddr,        setFarmerAddr]        = useState(d.farmerAddr ?? "");
  const zipRef   = useRef(null);
  const prefRef  = useRef(null);
  const cityRef  = useRef(null);
  const townRef  = useRef(null);
  const addrRef  = useRef(null);
  const [minWage, setMinWage] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!farmerPref) { setMinWage(null); return; }
    (async () => {
      try {
        const { data } = await supabase.rpc('get_minimum_wage', { p_prefecture: farmerPref });
        if (!cancelled) setMinWage(typeof data === 'number' ? data : null);
      } catch { if (!cancelled) setMinWage(null); }
    })();
    return () => { cancelled = true; };
  }, [farmerPref]);
  const [zipSearching,      setZipSearching]      = useState(false);
  const [zipError,          setZipError]          = useState("");
  // 郵便番号から住所を検索（zipLookup＝2系統レース＋タイムアウト＋キャッシュ・2026-08-02「数十秒」対策）。
  // 都道府県・市区町村を自動入力。
  // ★引数で郵便番号を受け取れるようにしてある（2026-07-29）：入力欄のonChangeから呼ぶとき、
  //   その時点の farmerZip state はまだ更新前なので、打たれた値を直接渡す必要がある
  const searchZip = async (zipRaw) => {
    const zip = String(zipRaw === undefined ? farmerZip : zipRaw).replace(/[^0-9]/g, "");
    if (zip.length !== 7) { setZipError("郵便番号は7桁で入力してください"); return; }
    setZipSearching(true); setZipError("");
    {
      const r = await zipLookup(zip);
      if (r.ok) {
        setFarmerPref(r.prefecture);
        setFarmerCity(r.city);
        // 町域まで自動入力（2026-07-16）。町域・番地は個別に手直しできる
        setFarmerTown(r.town || "");
        setFarmerRegion(r.prefecture + r.city + (r.town || ""));
        setZipError("");
        // 町域が取れたら番地欄へ、取れなければ町域欄へフォーカス
        setTimeout(() => { (r.town ? addrRef : townRef).current?.focus(); }, 0);
      } else {
        setZipError(r.reason === "notfound" ? "郵便番号が見つかりませんでした" : "検索に失敗しました。通信環境をご確認ください");
      }
    }
    setZipSearching(false);
  };
  // ★farmerZip を監視して自動検索する useEffect は廃止した（2026-07-29・集合場所が復元できない不具合の根治）。
  //   farmerZip に書き込む経路は5つあり、うち4つは「正しい住所を丸ごと入れる」復元処理だった：
  //     ①下書き復元（useStateの初期値 d.farmerZip） ②求人の編集読み込み ③「前回の住所を使う」
  //     ④集合場所ボックスの保存後（setFarmerTown(pbTown) 等で町域まで入れている）
  //   監視effectはこの4つでも発火し、直後に zipcloud の address3 で町域を上書きしていた。
  //   例：町域を「宮島」に直して保存 → その場で「忌部」（郵便番号が指す町域）に戻る。
  //   自動検索は「利用者が郵便番号を打った時」だけに限定する＝入力欄のonChangeから呼ぶ（下記）。
  const [farmerCropPill,    setFarmerCropPill]    = useState(d.farmerCropPill ?? ""); // 作物ピル選択
  const [farmerCropText,    setFarmerCropText]    = useState(d.farmerCropText ?? ""); // 作物自由入力
  const [farmerTaskPill,    setFarmerTaskPill]    = useState(d.farmerTaskPill ?? ""); // 作業ピル選択
  const [farmerTaskText,    setFarmerTaskText]    = useState(d.farmerTaskText ?? ""); // 作業自由入力
  const [farmerWanted,      setFarmerWanted]      = useState(d.farmerWanted ?? "");
  const [farmerPayType,     setFarmerPayType]     = useState(d.farmerPayType ?? "");
  const [payTiming,         setPayTiming]         = useState("即日払い（作業当日）");
  const [payMethod,         setPayMethod]         = useState("現金手渡し");
  // 勤務時間（4分割）
  const [startHour,   setStartHour]   = useState(d.startHour   ?? "8");
  const [startMinute, setStartMinute] = useState(d.startMinute ?? "00");
  const [endHour,     setEndHour]     = useState(d.endHour     ?? "16");
  const [endMinute,   setEndMinute]   = useState(d.endMinute   ?? "00");
  // 時給・日給（文字列で保持してカーソル飛び防止）
  const [hourlyWageInput, setHourlyWageInput] = useState(d.hourlyWageInput ?? "");
  const [dailyWageInput,  setDailyWageInput]  = useState(d.dailyWageInput  ?? "");
  // 日程（Date は JSON.parse で文字列になるので再変換）
  const [jobDateStart,    setJobDateStart]    = useState(d.jobDateStart ? new Date(d.jobDateStart) : null);
  const [jobDateEnd,      setJobDateEnd]      = useState(d.jobDateEnd   ? new Date(d.jobDateEnd)   : null);
  // 期間内の休日（2026-08-03たきと指示）："YYYY-MM-DD"配列。休日ボタン→カレンダータップで設定
  const [jobHolidays,     setJobHolidays]     = useState(Array.isArray(d.jobHolidays) ? d.jobHolidays : []);
  const [holidayMode,     setHolidayMode]     = useState(false); // 休日設定モード中はカレンダータップが休日トグルになる
  // 日程変更に休日を追従：期間の外に出た休日は自動で外す。単日（終了日なし）は全消し＝データが日程とズレない
  useEffect(() => {
    if (!jobDateStart || !jobDateEnd) setHolidayMode(false);
    setJobHolidays(prev => {
      if (!prev.length) return prev;
      if (!jobDateStart || !jobDateEnd) return [];
      const s = ymdLocal(jobDateStart), e = ymdLocal(jobDateEnd);
      const next = prev.filter(x => x > s && x < e);
      return next.length === prev.length ? prev : next;
    });
  }, [jobDateStart, jobDateEnd]);
  const [showCalendar,    setShowCalendar]    = useState(true);
  const [jobCount,        setJobCount]        = useState(d.jobCount ?? "");
  const [breakTime, setBreakTime] = useState(d.breakTime ?? "");
  const [commuteTime, setCommuteTime] = useState(d.commuteTime ?? "");
  const [nearestStation, setNearestStation] = useState(d.nearestStation ?? "");
  const [jobPhotos, setJobPhotos] = useState(normalizePhotos(d.jobPhotos)); // 旧形式draft対策（真っ白バグ・2026-07-16）
  // 写真の並び替えは LFPhotoReorderStrip（モジュールレベル・◀▶＋長押しドラッグ）に移動（2026-08-03）
  const [jobDescription, setJobDescription] = useState(d.jobDescription ?? "");
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [photoCaptionsOpen, setPhotoCaptionsOpen] = useState(false); // step8「写真ごとに説明」ポップアップ（2026-07-16）
  const [photoUploading, setPhotoUploading] = useState(false);
  const [jobDangerPlaces, setJobDangerPlaces] = useState((d.jobDangerPlaces ?? [{ icon:"⚠️", label:"", desc:"" }, { icon:"⚠️", label:"", desc:"" }]).map(p => ({ photos:[], ...p })));
  const [jobDangerTasks, setJobDangerTasks] = useState((d.jobDangerTasks ?? [{ icon:"⚠️", label:"", desc:"" }, { icon:"⚠️", label:"", desc:"" }]).map(t => ({ photos:[], ...t })));
  // 2つ目に中身があれば最初から展開（2026-07-16）：閉じたままだと編集も削除もできない見えない項目になる
  const [showPlace2, setShowPlace2] = useState(() => dangerHasSecond(d.jobDangerPlaces));
  const [showTask2, setShowTask2] = useState(() => dangerHasSecond(d.jobDangerTasks));
  const [confActiveSlide, setConfActiveSlide] = useState(0);
  const confScrollRef = useRef(null);
  // 確認ページ写真のループ（2026-07-16・詳細ページと同方式）：[最後,...実写真,最初]のクローンを並べ、端に静止したら実体位置へ瞬間ジャンプ
  const confLooped = jobPhotos.length > 1;
  const handleConfPhotoScroll = (e) => {
    const el = e.currentTarget;
    const w = el.clientWidth;
    if (!w) return;
    const idx = Math.round(el.scrollLeft / w);
    if (!confLooped) { setConfActiveSlide(idx); return; }
    const n = jobPhotos.length;
    const settled = Math.abs(el.scrollLeft - idx * w) < 2;
    if (settled && idx === 0) { el.scrollLeft = n * w; setConfActiveSlide(n - 1); return; }
    if (settled && idx === n + 1) { el.scrollLeft = w; setConfActiveSlide(0); return; }
    setConfActiveSlide(((idx - 1) % n + n) % n);
  };
  useEffect(() => {
    if (step !== 11 || !confLooped) return;
    const el = confScrollRef.current;
    if (el) requestAnimationFrame(() => { el.scrollLeft = el.clientWidth; }); // 初期位置＝実写真1枚目（クローンの次）
    setConfActiveSlide(0);
  }, [step, confLooped]); // eslint-disable-line react-hooks/exhaustive-deps
  const captionTextareaRef = useRef(null);
  const flowScrollRef = useRef(null); // スクロール領域（step遷移時に先頭へ戻す用）

  // draft 復元後に postLoginReturnTo を削除（1回だけ実行）
  useEffect(() => {
    if (_draftInit) {
      try { localStorage.removeItem('postLoginReturnTo'); } catch {}
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (_devJump) {
      try { localStorage.removeItem('devJump'); } catch {}
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 派生値
  const workTimeLabel = `${startHour}:${startMinute}〜${endHour}:${endMinute}`;
  const hourlyWage = Number(hourlyWageInput.replace(/[^\d]/g, "")) || 0;
  const dailyWage  = Number(dailyWageInput.replace(/[^\d]/g, "")) || 0;
  const workHours = (Number(endHour) + Number(endMinute) / 60) - (Number(startHour) + Number(startMinute) / 60);
  // 申告休憩（分）：DBトリガーと同じ抽出（"90分"等から最初の数字・無ければ0）
  const breakMinutes = Number((String(breakTime).match(/\d+/) || [0])[0]);
  const { hourlyViolation, dailyViolation, unknownWage } = validateMinWage(hourlyWage, dailyWage, workHours, minWage, breakMinutes);
  const [jobExp,            setJobExp]            = useState(d.jobExp ?? "");
  const [beginnerOk,        setBeginnerOk]        = useState(d.beginnerOk ?? false); // 🌱はじめての人も歓迎 → jobs.beginner_ok
  const [instantApproveRepeat, setInstantApproveRepeat] = useState(d.instantApproveRepeat ?? false); // 🌟また呼びたい即決 → jobs.instant_approve_repeat（効果は自分の求人×自分が評価した相手のみ・労働局確認済み）
  const [flagInfoOpen, setFlagInfoOpen] = useState(null); // 「はじめてOKとは？」「リピート即決とは？」の説明ボックス（2026-07-18）
  const [jobPerks, setJobPerks] = useState(d.jobPerks ?? null); // この求人だけの待遇上書き → jobs.perks（NULL=プロフィールの待遇・2026-07-18）
  const [experiencedPreferred, setExperiencedPreferred] = useState(d.experiencedPreferred ?? false); // 💪経験者優遇 → jobs.experienced_preferred（2026-07-18・必要経験の選択式は撤回）
  const [jobSaving, setJobSaving] = useState(false);
  // 掲載前の確認（2026-08-07たきと指示「チェックは1つにまとめる」）：4項目は本文として列挙し、
  // 「確認しました」1つのチェックで掲載ボタンを解錠する（旧：4つの個別チェックボックス）
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const [publishModal, setPublishModal] = useState(false); // 確認ページ下部ナビ「掲載する」→チェックリストモーダル
  // 募集者情報（①氏名・名称②住所・所在地③連絡先）が無ければ掲載申請できない（法令の明示事項・2026-07-27たきと指示）。
  // ページを移動せず、その場でボックスを開いて入力→保存→掲載申請を続行する。
  // 再開はrefに掴んだ関数を呼ぶ（handleSaveJobは確認ページのIIFE内定義なので、識別子は外から参照できない）
  const [recruitBox, setRecruitBox] = useState(null); // { name, address, contact, saving }
  const resumePublishRef = useRef(null);
  // 掲載＝即公開（2026-08-14 承認プロセスの削除・届出受理済み）。運営者本人は直接 open で INSERT、
  // 一般農家は pending 保存→publish_my_job RPC で即 open（RLSは draft/pending のまま＝直接の open 書き込みは不可）。
  // 掲載＝即公開（2026-08-14 承認プロセスの削除）：管理者か一般農家かの体験の分岐（meCanOpen）は廃止。
  // 実際の公開ゲートは不変（jobs admin write・trg_block_third_party_open thatが最終担保）。
  const [publishedOpen, setPublishedOpen] = useState(false); // 直前の掲載が即公開だったか（完了画面の文言に使う）
  // 時間外労働（2026-08-03）：有無＋「あり」のときの目安。労働条件の明示事項so求人ごとに持つ。
  const [overtimePolicy,    setOvertimePolicy]    = useState(d.overtimePolicy ?? "");
  const [overtimeDetail,    setOvertimeDetail]    = useState(d.overtimeDetail ?? "");
  const [overtimeInfoOpen,  setOvertimeInfoOpen]  = useState(false); // タイトル横「？」の説明展開（UI一時state・保存しない）
  // 掲載前の必須ガード（2026-07-24〜）：未入力のまま掲載に進ませない（終了求人コピー・編集の受け皿）。
  // 判定の中身は getPublishMissingFields（下）に集約し、openPublish もそこで定義している
  const [returnToConfirm, setReturnToConfirm] = useState(false);
  // 確認ページ用：本人の雇い手プロフィール（詳細ページempEmployerと同じデータ源employer_profiles）。
  // 読み込み前から出す（2026-08-03たきと指示「確認ページのプロフィールの復元が遅い」）：お仕事タブが
  // 保存した同じ全列データ（viewCache farm:empMini → アプリ再起動後は snapshot empMini）を初期値にし、
  // 裏で最新へ差し替える。キャッシュは表示専用の規則どおり（保存値・権限判定には使わない）
  const [confEmployer, setConfEmployer] = useState(() => getCache("farm:empMini") ?? snapGet("empMini") ?? null);
  const [confProfileOpen, setConfProfileOpen] = useState(false); // 農家プロ未入力時：カードタップで編集ボックス展開（2026-07-16）
  // 待遇の求人ごと変更（2026-07-18）：確認ページの待遇タップで編集ボックス。
  // 「この求人のみ」＝jobPerksに保持→jobs.perksへ保存（求人審査で内容確認）／「保存」＝プロフィールにも反映
  // （自由記述3項目=送迎範囲・通勤手当の内容・農家負担の上限はtexts_pending経由＝運営承認後に公開・憲法5条）
  const [perksEditOpen, setPerksEditOpen] = useState(false);
  const [perkDraft, setPerkDraft] = useState(null);
  // 待遇変更ボックス展開中は下部ナビ（←戻る・保存・掲載する）を画面下へ潜らせる（2026-08-07たきと指示）。
  // 非表示は unmount でなく transform：mount したまま translateY を切り替えることで、
  // 「下へ潜る」と「閉じたら戻る」の両方向が CSS transition で動く（unmountだと退場アニメが効かない）。
  // 移動量＝自分の高さ100%＋下余白＋セーフエリア＝画面外まで確実に出る
  // 確認ページのシートは3つとも同じ規格（枠・見出し・スクロール領域・下部ボタン）＝待遇の変更／
  // 農園プロフィール／掲載前の確認（2026-08-09たきと指示「最後の確認ボックスも待遇と同じ規格に」）。
  // 開いている間の扱い（下部ナビを潜らせる・背後のスクロールを止める）もここで一括して決める。
  const sheetOpen = perksEditOpen || confProfileOpen || publishModal;
  const sheetNavHide = {
    transform: sheetOpen ? "translateY(calc(100% + 24px + env(safe-area-inset-bottom, 0px)))" : "translateY(0)",
    transition: "transform .3s ease",
    pointerEvents: sheetOpen ? "none" : "auto",
  };
  // シート展開中は背後のページを動かさず、スクロールはシート内だけに効かせる（2026-08-09たきと指示）。
  // ★フローの本体は body ではなく flowScrollRef 自身がスクロールするため、汎用の cb-lock-scroll
  //   （html/bodyを固定・オーバーレイ側に付ける）だけでは止まらない。ここで overflowY も塞ぐ＝2枚で塞ぐ。
  //   シート内のスクロールは position:fixed の別要素なので、この overflow:hidden の影響を受けない。
  const flowScrollLock = sheetOpen ? { overflowY: "hidden" } : null;
  // overflow の切り替えでスクロール位置を失う環境への保険＝開く直前の位置を控え、閉じたらそこへ戻す。
  // 控えは必ず state を変える前に取る（描画後だと overflow:hidden 適用済みで 0 が返る環境がある）ため、
  // シートを開く3箇所で rememberFlowScroll() を呼ぶ
  const flowScrollTopRef = useRef(0);
  const rememberFlowScroll = () => { flowScrollTopRef.current = flowScrollRef.current?.scrollTop || 0; };
  useEffect(() => {
    if (sheetOpen) return;
    const el = flowScrollRef.current;
    if (el && flowScrollTopRef.current && el.scrollTop !== flowScrollTopRef.current) el.scrollTop = flowScrollTopRef.current;
  }, [sheetOpen]);
  const [perkSaving, setPerkSaving] = useState(false);
  const openPerksEdit = () => {
    rememberFlowScroll();
    const base = jobPerks ? { ...(confEmployer || {}), ...jobPerks } : (confEmployer || {});
    setPerkDraft({
      has_transport: !!base.has_transport, transport_area: base.transport_area || "",
      has_parking: !!base.has_parking, parking_capacity: base.parking_capacity || "",
      has_commute_allowance: !!base.has_commute_allowance, commute_allowance_detail: base.commute_allowance_detail || "",
      has_bonus: !!base.has_bonus,
      employer_pays_supplies: !!base.employer_pays_supplies, supplies_cap: base.supplies_cap || "",
      accessory_ok: !!base.accessory_ok,
      // 受動喫煙（2026-08-07たきと指示「ここでも変更可能に」）。jobPerksには入らないため常にプロフィール値
      smoking_policy: (confEmployer && confEmployer.smoking_policy) || "",
      smoking_area: (confEmployer && confEmployer.smoking_area) || "",
    });
    setPerksEditOpen(true);
  };
  // 「この求人のみ」（2026-08-07に関数化）：待遇はこの求人だけの上書き（jobPerks）へ。
  // ★受動喫煙だけは求人ごとの上書きにしない（2026-08-03たきと裁定：同一募集者が喫煙環境の異なる
  //   就業場所を掲載する事例が確認されるまで実装しない）。このボックスで変えた受動喫煙は、
  //   「この求人のみ」を押した場合も事業所の設定＝プロフィールへ保存する（UIにもその旨を明記）
  const applyPerksToJobOnly = async () => {
    if (perkSaving || !perkDraft) return;
    const { smoking_policy, smoking_area, ...jobOnly } = perkDraft;
    const nextArea = smoking_policy === "喫煙場所あり" ? (smoking_area || "").trim() : "";
    const changedSmoking = (smoking_policy || "") !== ((confEmployer && confEmployer.smoking_policy) || "")
      || nextArea !== ((confEmployer && confEmployer.smoking_area) || "");
    if (changedSmoking) {
      setPerkSaving(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const payload = { auth_id: session.user.id, smoking_policy: smoking_policy || null, smoking_area: nextArea };
          const { error } = await supabase.from("employer_profiles").upsert(payload, { onConflict: "auth_id" });
          if (error) { alert("受動喫煙の保存に失敗しました：" + error.message); setPerkSaving(false); return; }
          const next = { ...(confEmployer || {}), ...payload };
          setConfEmployer(next); setCache("farm:empMini", next);
        }
      } catch { alert("受動喫煙の保存に失敗しました。"); setPerkSaving(false); return; }
      setPerkSaving(false);
    }
    setJobPerks({ ...jobOnly });
    setPerksEditOpen(false);
  };
  const savePerksToProfile = async () => {
    if (perkSaving || !perkDraft) return;
    setPerkSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setPerkSaving(false); return; }
      const { data: cur } = await supabase.from("employer_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
      // 自由記述はtexts_pending経由（変わったキーだけ積む・EmployerProfileEdit.saveと同じ作法）。
      // 2026-08-14承認プロセス廃止後は、DBトリガー（trg_ep_z_publish_texts）that書いた瞬間に公開列へ畳む＝実質即公開
      const desired = {
        transport_area: perkDraft.has_transport ? (perkDraft.transport_area || "") : "",
        commute_allowance_detail: perkDraft.has_commute_allowance ? (perkDraft.commute_allowance_detail || "") : "",
        supplies_cap: perkDraft.employer_pays_supplies ? (perkDraft.supplies_cap.trim() || "") : "",
      };
      // 空にした項目（例：通勤手当のチェックを外す）は審査に出さず、その場で公開列を空にする
      // （2026-08-03たきと指示「入力項目を空にするなら審査は必要ない」）。審査は文字が入る変更だけ
      const { pending: newPend, cleared: clearedTexts } = splitTextsForReview(desired, cur || {});
      const pend = { ...((cur && cur.texts_pending) || {}) };
      Object.keys(desired).forEach(k => { delete pend[k]; });        // 今回触ったキーは一旦外し
      Object.entries(newPend).forEach(([k, v]) => { pend[k] = v; }); // 審査に出す分だけ積み直す
      const payload = {
        auth_id: session.user.id,
        ...clearedTexts, // 空にした項目は即その場で消す（審査を通さない）
        has_transport: perkDraft.has_transport,
        has_parking: perkDraft.has_parking,
        // parking_capacityはinteger列。「3台」等の文字が混ざっても数字だけ取り出し、空はnull（2026-07-19修正）
        parking_capacity: (() => { const n = parseInt(String(perkDraft.parking_capacity ?? "").replace(/[^0-9]/g, ""), 10); return (perkDraft.has_parking && Number.isFinite(n)) ? n : null; })(),
        has_commute_allowance: perkDraft.has_commute_allowance,
        has_bonus: perkDraft.has_bonus,
        employer_pays_supplies: perkDraft.employer_pays_supplies,
        accessory_ok: perkDraft.accessory_ok,
        // 受動喫煙（2026-08-07）：EmployerProfileEditと同じ作法＝直接列へ。
        // 「あり」以外を選んだら場所の記述は保存しない（選び直しの残骸を残さない）
        smoking_policy: perkDraft.smoking_policy || null,
        smoking_area: perkDraft.smoking_policy === "喫煙場所あり" ? (perkDraft.smoking_area || "").trim() : "",
        texts_pending: pend,
        texts_submitted_at: Object.keys(pend).length ? new Date().toISOString() : ((cur && cur.texts_submitted_at) || null),
        // 再提出で修正依頼フラグ（赤帯）を解除（2026-07-19）
        ...(Object.keys(pend).length ? { texts_revision_requested_at: null } : {}),
      };
      const { error } = await supabase.from("employer_profiles").upsert(payload, { onConflict: "auth_id" });
      if (error) { alert("保存に失敗しました：" + error.message); setPerkSaving(false); return; }
      setJobPerks(null); // プロフィールに保存＝この求人はプロフィールの待遇に従う
      try {
        const { data: ep } = await supabase.from("employer_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (ep) { setConfEmployer(ep); setCache("farm:empMini", ep); }
      } catch {}
      setPerksEditOpen(false);
    } catch { alert("保存に失敗しました。"); }
    setPerkSaving(false);
  };
  const [confTrust, setConfTrust] = useState(() => getCache("farm:empTrust") ?? null); // 確認ページ用：登録してからの月日など（employer_trust_info・お仕事タブと同じキャッシュ）
  const [confGeo, setConfGeo] = useState(null); // 確認ページ用：住所→座標（詳細ページと同構造のJobLocationMap表示に使用）
  const [confIntroOpen, setConfIntroOpen] = useState(false); // 確認ページ用：農園紹介モーダル（詳細ページと同構造）
  const [jobNotes,          setJobNotes]          = useState(d.jobNotes ?? "");
  const [jobCautions,       setJobCautions]       = useState(d.jobCautions ?? "");
  const [jobTemplate,       setJobTemplate]       = useState(d.jobTemplate ?? "収穫補助");

  // ピル選択とテキスト入力の合成値（自由入力優先）
  const farmerCrop = farmerCropPill === "__other__" ? farmerCropText.trim() : (farmerCropText.trim() || farmerCropPill);
  const farmerTask = farmerTaskPill === "__other__" ? farmerTaskText.trim() : (farmerTaskText.trim() || farmerTaskPill);

  // 働き手 state
  const [workerExp,         setWorkerExp]         = useState("");
  const [workerPurpose,     setWorkerPurpose]     = useState(_devJump?.workerPurpose ?? "");
  const [workerDisplayName, setWorkerDisplayName] = useState("");
  const [workerRegion,      setWorkerRegion]      = useState("");
  const [workerTransport,   setWorkerTransport]   = useState("");
  const [workerDays,        setWorkerDays]        = useState([]);
  const [workerTimeSlot,    setWorkerTimeSlot]    = useState("");
  const [workerWork,        setWorkerWork]        = useState("");
  const [workerCrop,        setWorkerCrop]        = useState("");
  const [workerHourly,      setWorkerHourly]      = useState("");
  const [workerDaily,       setWorkerDaily]       = useState("");
  const [workerHours,       setWorkerHours]       = useState("");

  const isFarmer = role === "farmer";
  const isWorker = role === "worker";
  const TOTAL = isFarmer ? 14 : 8;

  // step遷移アニメ：退場(0.4s)→step切替→入場(0.4s)＝体感0.8秒（2026-07-16）。連打はbusyガードで無視
  const [stepAnim, setStepAnim] = useState("");
  const stepAnimBusy = useRef(false);
  const animateStepChange = (applyChange, dir) => {
    if (stepAnimBusy.current) return;
    stepAnimBusy.current = true;
    setStepAnim(dir === "fwd" ? "step-out-left" : "step-out-right");
    setTimeout(() => {
      applyChange();
      setStepAnim(dir === "fwd" ? "step-in-right" : "step-in-left");
      stepAnimBusy.current = false;
    }, 400);
  };
  const goNext = () => animateStepChange(() => setStep(s => s + 1), "fwd");
  const goBack = () => animateStepChange(() => { if (step <= 1) { setStep(0); } else setStep(s => s - 1); }, "back");
  // 全stepスワイプ移動（2026-07-16）：左スワイプ=次へ（バリデーション尊重）／右スワイプ=戻る。
  // 掲載(step11→)と完了(step12)からは進めない。step1の戻りはスワイプでも不可（戻るボタン削除と整合）
  const flowSwipe = useRef(null);
  const onFlowTouchStart = (e) => { flowSwipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };

  // 確認ページ(step11)からの編集ジャンプ中フラグ。trueの間、共通フッターの「次へ／戻る」は
  // 通常の順送りでなく確認ページへ直帰する（Airbnb出品確認の「編集→保存して確認へ戻る」と同型）。
  useEffect(() => {
    if (step === 11) setReturnToConfirm(false); // 確認ページ到達で必ず解除（保険）
    if (step === 12) fbCelebrate(); // 完了ページ到達＝祝祭の音と振動（2026-08-06・画面は既存の完了ページのまま）
  }, [step]);

  useEffect(() => {
    if (onStepChange && role === "farmer" && step >= 1 && step <= 11) onStepChange(step);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const [draftJobNumber, setDraftJobNumber] = useState(_editJobNumber ?? _draftInit?.job_number ?? null);
  const [confTab, setConfTab] = useState("content"); // 確認ページの「仕事の内容/質問」タブ（第10弾）
  // 集合場所の復元元＝農家プロフィールの「作業場所」（2026-07-16・直近jobsからの復元は撤回）。未設定ならnull=ボタン非表示
  const [prevAddress, setPrevAddress] = useState(null);
  useEffect(() => {
    if (!isFarmer || step !== 3 || prevAddress) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;
        const { data: ep } = await supabase.from("employer_profiles")
          .select("place_zip,place_prefecture,place_city,place_town,place_address")
          .eq("auth_id", session.user.id).maybeSingle();
        if (cancelled || !ep) return;
        if ((ep.place_city || "").trim() || (ep.place_zip || "").trim() || (ep.place_address || "").trim()) {
          setPrevAddress({ zip: ep.place_zip, prefecture: ep.place_prefecture, city: ep.place_city, town: ep.place_town, address: ep.place_address });
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [step, isFarmer]); // eslint-disable-line react-hooks/exhaustive-deps
  // 農家プロの作業場所が未入力のとき：⎘タップでこの入力ボックスを展開し、保存で「農家プロ＋求人フロー」両方へ反映（2026-07-16）
  const [placeBoxOpen, setPlaceBoxOpen] = useState(false);
  // 集合場所の説明の一本化（2026-08-08たきと指示「各説明が散乱して読まない。1箇所に・〇〇とは？形式で」）：
  // 欄ごとに散らばっていた注記（自動入力・町域まで公開・番地は会員のみ・プライバシー）を
  // 「集合場所の公開範囲とは？」のタップ展開1つに集約。UI一時state・保存しない
  const [placeInfoOpen, setPlaceInfoOpen] = useState(false);
  const [pbZip, setPbZip] = useState("");
  const [pbPref, setPbPref] = useState("");
  const [pbCity, setPbCity] = useState("");
  const [pbTown, setPbTown] = useState("");
  const [pbAddr, setPbAddr] = useState("");
  const [pbBusy, setPbBusy] = useState(false);
  const [pbErr, setPbErr] = useState("");
  const [pbSaving, setPbSaving] = useState(false);
  const searchPbZip = async () => {
    const zip = pbZip.replace(/[^0-9]/g, "");
    if (zip.length !== 7) { setPbErr("郵便番号は7桁で入力してください"); return; }
    setPbBusy(true); setPbErr("");
    const r = await zipLookup(zip);
    if (r.ok) { setPbPref(r.prefecture); setPbCity(r.city); setPbTown(r.town || ""); }
    else { setPbErr(r.reason === "notfound" ? "郵便番号が見つかりませんでした" : "検索に失敗しました。通信環境をご確認ください"); }
    setPbBusy(false);
  };
  const savePlaceBox = async () => {
    if (pbSaving) return;
    setPbSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { alert("ログインが必要です"); setPbSaving(false); return; }
      const { error } = await supabase.from("employer_profiles").upsert({
        auth_id: session.user.id,
        place_zip: pbZip.trim(), place_prefecture: pbPref.trim(), place_city: pbCity.trim(),
        place_town: pbTown.trim(), place_address: pbAddr.trim(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "auth_id" });
      if (error) { alert("保存に失敗しました：" + error.message); setPbSaving(false); return; }
      // 求人フロー側の集合場所にも反映
      setFarmerZip(pbZip.trim()); setFarmerPref(pbPref.trim()); setFarmerCity(pbCity.trim());
      setFarmerTown(pbTown.trim()); setFarmerAddr(pbAddr.trim());
      setFarmerRegion(pbPref.trim() + pbCity.trim() + pbTown.trim());
      setZipError("");
      setPrevAddress({ zip: pbZip.trim(), prefecture: pbPref.trim(), city: pbCity.trim(), town: pbTown.trim(), address: pbAddr.trim() });
      setPlaceBoxOpen(false);
    } catch (e) { alert("保存に失敗しました"); }
    setPbSaving(false);
  };
  // jobs行 → フローのstateへ復元（2026-08-03に関数化）。コピー直後の即時復元（prefill）と
  // 通常の読み込みで同じ対応表を使う＝どちらかだけ直して食い違う事故を防ぐ
  const applyJobRow = (data) => {
        setRole("farmer");
        setFarmerCropText(data.crop ?? "");
        setFarmerTaskText(data.task ?? "");
        setFarmerZip(data.zip ?? "");
        setFarmerPref(data.prefecture ?? "");
        setFarmerCity(data.city ?? "");
        setFarmerTown(data.town ?? "");
        setFarmerAddr(data.address ?? "");
        setFarmerRegion((data.prefecture ?? "") + (data.city ?? "") + (data.town ?? ""));
        setJobDateStart(data.date_start ? new Date(data.date_start) : null);
        setJobDateEnd(data.date_end ? new Date(data.date_end) : null);
        setJobCount(data.headcount != null ? String(data.headcount) : "");
        setFarmerPayType(data.pay_type ?? ""); // 報酬方式（時給/日給）も復元（2026-07-24・コピー/再開で欠けていた）
        setHourlyWageInput(data.hourly_wage ?? "");
        setDailyWageInput(data.daily_wage ?? "");
        // 勤務時間（"H:MM〜H:MM"）を start/end に復元（2026-07-24・コピー/再開で欠けていた）
        { const wt = String(data.work_time ?? "").match(/(\d{1,2}):(\d{2})\D+(\d{1,2}):(\d{2})/); if (wt) { setStartHour(wt[1]); setStartMinute(wt[2]); setEndHour(wt[3]); setEndMinute(wt[4]); } }
        setBreakTime(data.break_time ?? "");
        setNearestStation(data.nearest_station ?? "");
        setCommuteTime(data.commute_time ?? "");
        setJobExp(data.job_exp ?? "");
        setBeginnerOk(!!data.beginner_ok);
        setInstantApproveRepeat(!!data.instant_approve_repeat);
        setJobPerks(data.perks || null);
        setExperiencedPreferred(!!data.experienced_preferred);
        setJobDescription(data.notes ?? "");
        setJobNotes(data.belongings ?? "");
        setJobCautions(data.cautions ?? "");
        setOvertimePolicy(data.overtime_policy ?? "");
        setOvertimeDetail(data.overtime_detail ?? "");
        // photos未所持の旧データを補完しつつ復元。2つ目に中身があれば展開フラグも立てる（2026-07-16）
        const dp = (data.danger_places ?? []).map(x => ({ photos: [], ...x }));
        const dt = (data.danger_tasks ?? []).map(x => ({ photos: [], ...x }));
        setJobDangerPlaces(dp.length ? dp : [{ icon:"⚠️", label:"", desc:"", photos:[] }, { icon:"⚠️", label:"", desc:"", photos:[] }]);
        setJobDangerTasks(dt.length ? dt : [{ icon:"⚠️", label:"", desc:"", photos:[] }, { icon:"⚠️", label:"", desc:"", photos:[] }]);
        setShowPlace2(dangerHasSecond(dp));
        setShowTask2(dangerHasSecond(dt));
        setJobPhotos(normalizePhotos(data.photos)); // 旧形式（文字列配列）の求人でも真っ白にならないよう正規化（2026-07-16）
        setJobHolidays(Array.isArray(data.holidays) ? data.holidays : []);
        setStep(data.draft_step != null ? data.draft_step : 11);
  };

  // 編集・コピーで開いた時の復元（2026-08-03に高速化）。
  // 【従来の問題】stepの初期値が0（＝フローの入口）で、jobsを読み終えてから確認ページへ飛ぶ設計だった。
  // そのため通信が少しでも遅いと「はじめから」の画面が見え続けた（コピー直後に多発）。
  // 【対処】①stepの初期値を編集モードでは11（確認ページ）に変更＝入口をそもそも描かない
  //        ②コピー直後は copy_job that返した行をsessionStorage経由で受け取り、通信を待たずに即復元
  //        ③通常の読み込みは getSession の往復を待たない（jobsのRLS owner select that自分の行に絞るso
  //          farmer_idの明示条件は冗長だった）＝1往復ぶん速くなる
  useEffect(() => {
    if (!_editJobNumber) return;
    // ②コピー直後の即時復元：copy_jobの返り値をそのまま使う（ネット往復ゼロ）。一度きりで消費する
    try {
      const raw = sessionStorage.getItem("cb_editJobPrefill");
      if (raw) {
        sessionStorage.removeItem("cb_editJobPrefill");
        const row = JSON.parse(raw);
        if (row && row.job_number === _editJobNumber) applyJobRow(row);
      }
    } catch {}
    (async () => {
      try {
        // ③セッションと求人を並列で取る（従来はgetSession→jobsの直列で、JWT更新が走ると
        //   その待ちがまるまる上乗せされていた）。取れなければ何もしない（prefillの値を残す）
        const [sessRes, jobRes] = await Promise.all([
          supabase.auth.getSession(),
          supabase.from("jobs").select("*").eq("job_number", _editJobNumber).maybeSingle(),
        ]);
        const uid = sessRes?.data?.session?.user?.id;
        const data = jobRes?.data;
        if (jobRes?.error || !data) return;
        // 所有者チェックは維持（管理者はRLS上ずべての求人を読めるso、他人の求人を編集フローで開かせない）
        if (!uid || data.farmer_id !== uid) return;
        applyJobRow(data);
      } catch {}
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftMsg, setDraftMsg] = useState("");
  const [draftBarFull, setDraftBarFull] = useState(false);
  const [draftOverlay, setDraftOverlay] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  // その場保存（下部ナビ「保存」）の完了表示。遷移しない代わりに、保存できたことをここで知らせる
  const [savedToast, setSavedToast] = useState(false);
  const savedToastTimer = useRef(null);
  useEffect(() => () => { if (savedToastTimer.current) clearTimeout(savedToastTimer.current); }, []);

  // ドラフト保存 → ログイン後に LandingFlow 初期化時に復元される
  const saveDraft = () => {
    try {
      const draft = {
        role: "farmer", farmerStep: step, job_number: draftJobNumber, // 保存時点の実ステップとupsertキーを記録
        farmerExp, farmerPurpose, farmerDisplayName, farmerRegion,
        farmerZip, farmerPref, farmerCity, farmerTown, farmerAddr, jobPhotos,
        farmerCropPill, farmerCropText, farmerTaskPill, farmerTaskText,
        farmerWanted, farmerPayType, payTiming, payMethod,
        startHour, startMinute, endHour, endMinute,
        jobCount, breakTime, commuteTime, nearestStation, jobDangerPlaces, jobDangerTasks, hourlyWageInput, dailyWageInput,
        jobExp, jobTemplate, jobNotes, jobCautions, overtimePolicy, overtimeDetail, jobDescription, beginnerOk, instantApproveRepeat, jobPerks, experiencedPreferred,
        jobDateStart: jobDateStart?.toISOString() ?? null,
        jobDateEnd:   jobDateEnd?.toISOString()   ?? null,
        jobHolidays,
      };
      localStorage.setItem('landingFlowDraft_v1', JSON.stringify(draft));
      localStorage.setItem('postLoginReturnTo', 'landingFlowFarmerConfirm');
      // ログイン後: LandingFlow 初期化時に _draftInit が読み込まれ、
      //   role="farmer", step=5（確認画面）として復元される
    } catch {}
  };

  // ── カレンダーヘルパー ──────────────────────────────────────
  const WD = ["日","月","火","水","木","金","土"];
  const fmtD = (d, opts = {}) => {
    if (!d) return "";
    const w = WD[d.getDay()];
    if (opts.omitYearMonth) return `${d.getDate()}（${w}）`;
    if (opts.omitYear) return `${d.getMonth()+1}/${d.getDate()}（${w}）`;
    return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}（${w}）`;
  };
  // 日程ラベル（2026-07-16）：年内に終了なら年を省く。年内かつ同じ月で終了なら終了側は年と月も省く
  const jobDateLabel = (() => {
    if (!jobDateStart) return "日程を選択してください";
    const end = jobDateEnd || jobDateStart;
    const thisYear = new Date().getFullYear();
    const inYear = jobDateStart.getFullYear() === thisYear && end.getFullYear() === thisYear;
    if (jobDateStart.toDateString() === end.toDateString()) return fmtD(jobDateStart, { omitYear: inYear });
    const sameMonth = inYear && jobDateStart.getMonth() === end.getMonth();
    return `${fmtD(jobDateStart, { omitYear: inYear })} 〜 ${fmtD(end, sameMonth ? { omitYearMonth: true } : { omitYear: inYear })}`;
  })();

  const buildJobPayload = async (authUid, statusVal = "pending") => {
    const geo = await geocodeTown(farmerPref, farmerCity, farmerTown);
    return {
      farmer_id:       authUid,
      crop:            farmerCrop,
      task:            farmerTask,
      zip:             farmerZip,
      prefecture:      farmerPref,
      city:            farmerCity,
      town:            farmerTown,
      address:         farmerAddr,
      date_label:      jobDateLabel,
      date_start:      jobDateStart ? ymdLocal(jobDateStart) : null,
      date_end:        jobDateEnd ? ymdLocal(jobDateEnd) : null,
      holidays:        jobHolidays,
      headcount:       Number(jobCount) || null,
      pay_type:        "日給", // 時給入力は廃止（2026-07-16）。新規保存は常に日給
      hourly_wage:     "", // 時給入力は廃止（2026-07-16）。レガシー下書きの隠れ値を保存しない
      daily_wage:      dailyWageInput,
      work_time:       workTimeLabel,
      break_time:      breakTime,
      nearest_station: nearestStation,
      commute_time:    commuteTime,
      job_exp:         jobExp,
      beginner_ok:     beginnerOk,
      instant_approve_repeat: instantApproveRepeat,
      perks:           jobPerks,
      experienced_preferred: experiencedPreferred,
      notes:           jobDescription,
      belongings:      jobNotes,
      cautions:        jobCautions,
      // 「あり」以外を選んだら目安は保存しない（選び直しの残骸を残さない・受動喫煙と同じ作法）
      overtime_policy: overtimePolicy || null,
      overtime_detail: overtimePolicy === "あり" ? overtimeDetail.trim() : "",
      danger_places:   jobDangerPlaces,
      danger_tasks:    jobDangerTasks,
      photos:          jobPhotos,
      draft_step:      step,
      status:          statusVal,
      lat:             geo ? geo.lat : null,
      lng:             geo ? geo.lng : null,
      geo_radius_m:    geo ? geo.radius : null,
      geocoded_from:   geo ? geo.from : null,
    };
  };

  const saveDraftToSupabase = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { ok:false, reason:"no_session" };
      const payload = await buildJobPayload(session.user.id, "draft");
      if (draftJobNumber) {
        const { error } = await supabase.from("jobs").update(payload).eq("job_number", draftJobNumber).eq("farmer_id", session.user.id);
        if (error) return { ok:false, reason:error.message };
        return { ok:true, jobNumber:draftJobNumber };
      } else {
        const { data, error } = await supabase.from("jobs").insert(payload).select("job_number").single();
        if (error) return { ok:false, reason:error.message };
        setDraftJobNumber(data.job_number);
        try { const _d = JSON.parse(localStorage.getItem("landingFlowDraft_v1")||"{}"); _d.job_number = data.job_number; localStorage.setItem("landingFlowDraft_v1", JSON.stringify(_d)); } catch {}
        return { ok:true, jobNumber:data.job_number };
      }
    } catch (e) { return { ok:false, reason:String(e) }; }
  };

  // 保存の出口（2026-08-07たきと指示「確認ページで保存を押すと求人ページに戻る」で exit:true に一本化）：
  // ・exit:true  ＝ 保存してフローを閉じ、求人ページ（お仕事タブ）へ着地する。
  //   確認ページ下部ナビの「保存」も、終了モーダルの「保存して終了」もこちら
  // ・exit:false ＝ その場保存（現在呼び出し無し。savedToastの仕組みは復活に備えて温存）
  //   ※2026-08-03「更新は完了させるが、ページ遷移はさせるな」は本日の指示で置き換え
  const handleTopSave = async ({ exit = false } = {}) => {
    if (draftSaving) return;
    setDraftSaving(true); setDraftMsg("");
    const res = await saveDraftToSupabase();
    setDraftSaving(false);
    if (res.ok) {
      if (!exit) { // その場保存：遷移も cb_afterDraftSave（着地先の指定）もしない。保存できたことだけ知らせる
        setSavedToast(true);
        if (savedToastTimer.current) clearTimeout(savedToastTimer.current);
        savedToastTimer.current = setTimeout(() => setSavedToast(false), 1800);
        return;
      }
      try { sessionStorage.setItem("cb_afterDraftSave","1"); } catch {}
      setDraftOverlay(true);
      setTimeout(() => { setDraftOverlay(false); window.location.hash = "/work"; if (typeof onComplete === "function") onComplete(); }, 1100);
    } else if (res.reason === "no_session") {
      saveDraft(); onLogin();
    } else {
      setDraftMsg("保存に失敗しました：" + res.reason);
      alert("保存に失敗しました：" + res.reason);
    }
  };

  // devJumpは1回のマウントで消費したら破棄する（残り続けると、後日の通常フロー起動時に
  // _devJumpが読まれて古いstep/roleへ勝手にジャンプする。読み込み済みの_devJump変数には影響しない）
  useEffect(() => { try { localStorage.removeItem('devJump'); } catch {} }, []);

  // 働き手フロー完了（step8）＝ページでなくアニメーション（2026-08-07たきと指示・③）。
  // onWorkerDone があれば親（App）that祝祭＋案内トースト＋着地を出すので、ここでは1回通知するだけで何も描かない
  // （フロー自体は親that閉じる＝フロー内に祝祭を置くとアンマウントで消えるため親側に置く・onPublishedと同じ作法）。
  // 未指定の呼び出しは従来の完了画面にフォールバック（onPublished未指定→step12と同じ後方互換）
  const workerDoneFired = useRef(false);
  useEffect(() => {
    if (!(isWorker && step === 8) || typeof onWorkerDone !== "function") return;
    if (workerDoneFired.current) return;
    workerDoneFired.current = true;
    onWorkerDone();
  }, [isWorker, step, onWorkerDone]);

  // 確認ページ到達時：住所からおおよその座標を取得（保存時のgeocodeTownと同じ手順。
  // 取得失敗・住所未入力ならnullのまま＝JobLocationMapが「地図は準備中です」を表示）
  useEffect(() => {
    if (step !== 11 || role !== "farmer") return;
    let cancelled = false;
    (async () => {
      const geo = await geocodeTown(farmerPref, farmerCity, farmerTown);
      if (!cancelled) setConfGeo(geo);
    })();
    return () => { cancelled = true; };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // 確認ページ用：本人の雇い手プロフィールを取得（詳細ページと同構造のプロフィールカード・農園紹介に使用。
  // 未ログイン・未作成なら null のまま＝最小カードにフォールバック）
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        // 依存の無い2本は並列（2026-08-03・直列2往復→1往復ぶんの待ちに）。
        // 取得できたらお仕事タブと同じキャッシュへ書き戻す＝どちらの画面から入っても次回は即描画
        const [epRes, tRes] = await Promise.all([
          supabase.from("employer_profiles").select("*").eq("auth_id", session.user.id).maybeSingle(),
          Promise.resolve(supabase.rpc("employer_trust_info", { p_farmer_id: session.user.id })).catch(() => ({ data: null })),
        ]);
        if (epRes.data) { setConfEmployer(epRes.data); setCache("farm:empMini", epRes.data); }
        const t = tRes.data;
        if (t && t.ok) { setConfTrust(t); setCache("farm:empTrust", t); }
      } catch {}
    })();
  }, [confProfileOpen]); // 編集ボックスを閉じたら再取得＝入力したプロフィールが確認ページに即反映（2026-07-16）

  // プロフィール入力のお願い（2026-07-17）：確認ページ到達時、農家プロに未入力の項目があれば
  // Appルートへ通知（cb:confirmNotice→trigger=confirmのお知らせ展開）。判定項目は農家プロ入口の
  // ボックス格子(boxFilled: avatar/nickname/place/perks/staff/intro/ask/style)と同じ8区分
  useEffect(() => {
    if (step !== 11 || role !== "farmer") return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data: ep } = await supabase.from("employer_profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (cancelled) return;
        const filledText = (...vals) => vals.some(v => (v || "").trim() !== "");
        const hasUnfilled = !ep
          || !ep.avatar_url
          || !filledText(ep.nickname)
          || !filledText(ep.place_city)
          || !(ep.has_transport || ep.has_parking || ep.has_commute_allowance || ep.has_bonus || ep.employer_pays_supplies || ep.accessory_ok)
          || !filledText(ep.owner_comment, ep.intro_path, ep.intro_joy, ep.intro_crops, ep.intro_atmosphere, ep.intro_message)
          || !filledText(ep.unique_point, ep.always_do, ep.break_style)
          || !filledText(ep.interaction_style);
        if (hasUnfilled) window.dispatchEvent(new Event("cb:confirmNotice"));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  // お知らせの「はじめる」リンク（event:cb:openConfProfile）＝農家プロ入力ボックスをこの場で展開
  useEffect(() => {
    const f = () => { rememberFlowScroll(); setConfProfileOpen(true); };
    window.addEventListener("cb:openConfProfile", f);
    return () => window.removeEventListener("cb:openConfProfile", f);
  }, []);

  // Airbnb模擬・部品1:step移動ごとに自動で下書き保存（農家フロー中のみ・home(0)と完了(12)は除外）
  useEffect(() => {
    if (role === "farmer" && step >= 1 && step <= 11) saveDraft();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // step遷移時にスクロール位置をトップへリセット（前ページの途中位置が引き継がれるのを防ぐ）
  useEffect(() => {
    try {
      if (flowScrollRef.current) flowScrollRef.current.scrollTo(0, 0);
      window.scrollTo(0, 0);
    } catch {}
  }, [step]);

  // 選択した瞬間に次へ進む（140ms で選択状態を視認させてから遷移）
  const selectAndNext = (setter, value) => {
    setter(value);
    setTimeout(() => setStep(s => s + 1), 140);
  };

  // 自動遷移ステップ（次へボタン非表示、戻るのみ表示）
  const isAutoStep = (
    step === 0 ||
    (isWorker && step === 1) ||
    (isWorker && step === 2)
  );

  // UI helpers はモジュールレベルに移動済み（LF_ プレフィックス）

  // ── タイポグラフィ定数 ─────────────────────────────────────
  const lfStyles = {
    heroTitle: {
      fontSize:"clamp(28px, 4vw, 42px)", fontWeight:850, lineHeight:1.22,
      letterSpacing:"-0.04em", color:"#222", textAlign:"center", margin:"24px 0 12px",
    },
    stepTitle: {
      fontSize:"clamp(26px, 3.2vw, 36px)", fontWeight:850, lineHeight:1.25,
      letterSpacing:"-0.035em", color:"#222", textAlign:"center", margin:"32px 0 10px",
    },
    subtitle: {
      fontSize:"clamp(16px, 1.6vw, 18px)", lineHeight:1.7, color:"#717171",
      textAlign:"center", margin:"0 auto 28px", maxWidth:520,
    },
    question: {
      fontSize:"clamp(18px, 2vw, 22px)", fontWeight:750, lineHeight:1.4,
      color:"#222", textAlign:"center", margin:"28px 0 18px",
    },
    cardTitle: {
      fontSize:"clamp(16px, 1.8vw, 20px)", fontWeight:750, color:"#222",
      lineHeight:1.45, marginBottom:4,
    },
    cardDesc: {
      fontSize:"clamp(13px, 1.4vw, 15px)", lineHeight:1.75, color:"#717171",
    },
    note: {
      fontSize:"clamp(13px, 1.1vw, 14px)", lineHeight:1.8, color:"#B0B0B0", textAlign:"center",
    },
    inputLabel: { fontSize:14, fontWeight:700, color:"#222", marginBottom:6, display:"block" },
    featureTitle: { fontSize:"clamp(14px, 1.5vw, 16px)", fontWeight:700, color:"#222", marginBottom:3 },
    featureDesc: { fontSize:"clamp(13px, 1.3vw, 14px)", lineHeight:1.75, color:"#717171" },
  };

  // canGoNext per step
  // 農家6ステップ: 0=home,1=就農歴,2=目的,3=プロフィール,4=詳細,5=確認,6=完了
  const prefNotAllowed = !!farmerPref.trim() && !isAllowedPrefecture(farmerPref);
  // 時間外労働の入力が揃っているか（2026-08-03たきと指示「必須」）：有無は必ず選ぶ。
  // 「あり」なら目安の時間まで書く＝「有無（どれくらいの時間）」を明記させる
  const overtimeOk = !!overtimePolicy && (overtimePolicy !== "あり" || !!overtimeDetail.trim());
  const farmerCanNext = [true, !!farmerCrop, !!farmerTask, !!farmerZip.trim()&&isAllowedPrefecture(farmerPref)&&!!farmerCity.trim()&&!!farmerTown.trim()&&!!farmerAddr.trim(), !!jobDateStart && Number(jobCount) > 0, farmerPurpose !== "post" || (!!dailyWageInput && !dailyViolation && breakTime !== "" && overtimeOk), true, true, true, true, true, true, true];
  const workerCanNext = [true, !!workerExp, !!workerPurpose, true, true, true, true, true, true];
  const canGoNext = isFarmer ? (farmerCanNext[step] ?? true) : isWorker ? (workerCanNext[step] ?? true) : true;

  // ↓ここに置く理由：この中で canGoNext を読むため、その宣言より後ろに置く
  //   （2026-07-29に並べ替え・中身は不変。参照はJSXのonTouchEndのみ）
  const onFlowTouchEnd = (e) => {
    const s = flowSwipe.current;
    flowSwipe.current = null;
    if (!s || publishModal || showExitModal || photoCaptionsOpen || placeBoxOpen) return;
    if (step === 11) return; // 確認ページは横スワイプ遷移なし（2026-07-16たきと指定・写真カルーセル優先）
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return; // 縦スクロール優先
    if (dx < 0) {
      if (step === 11 || step === 12 || step >= TOTAL || !canGoNext) return;
      if (returnToConfirm) { setStep(11); setReturnToConfirm(false); return; }
      goNext();
    } else {
      if (step <= 1 || step === 12 || step >= TOTAL) return;
      if (returnToConfirm) { setStep(11); setReturnToConfirm(false); return; }
      goBack();
    }
  };

  // 掲載（status=pending投入）前の必須項目チェック。欠けている項目を {label, step} で返す。
  // ★掲載前チェックの唯一のソース＝「掲載する」(openPublish)と保存(handleSaveJob)の両方がここを見る。
  //   必須項目を足すときはこの表だけ直す。2箇所に散らすと、確認ページに直接入る経路
  //   （求人の編集・コピー＝step3/4/5を通らない）がフロントを素通りし、DBのエラーで止まることになる。
  // step はその項目を入力するページ＝案内するだけでなく、その欄へ実際に送るために持たせている。
  const getPublishMissingFields = () => {
    const checks = [
      ["作物",                   !!farmerCrop,                        1],
      ["作業",                   !!farmerTask,                        2],
      ["郵便番号",                !!farmerZip.trim(),                  3],
      ["都道府県（徳島県）",        isAllowedPrefecture(farmerPref),     3],
      ["市区町村",                !!farmerCity.trim(),                 3],
      ["町域",                   !!farmerTown.trim(),                 3],
      ["番地・建物名",             !!farmerAddr.trim(),                 3],
      ["作業日程（開始日）",       !!jobDateStart,                      4],
      ["採用人数",                Number(jobCount) > 0,                4],
      // 勤務時間：終了が開始以前だと、DB側の job_scheduled_minutes が null を返して掲載が止まる。
      // かつ日給の最賃判定（validateMinWage）も workHours>0 のときしか働かないため、ここで先に止める
      ["勤務時間（開始〜終了）",    workHours > 0,                       5],
      ["日給（最低賃金以上）", !!dailyWageInput && !dailyViolation,      5],
      ["休憩時間",                breakTime !== "",                    5],
      ["時間外労働",              overtimeOk,                          5],
    ];
    // プロフィール由来の掲載必須（2026-08-07たきと承認＝「掲載を押して初めて要求される」の予防）。
    // confEmployer（farm:empMiniキャッシュ＝step11で最新化）が読めている時だけ判定＝
    // 読めていない時は誤って空扱いにせず、従来どおり掲載時のDBゲート・recruitBoxに任せる。
    // step=null＝行き先がフロー内に無い（プロフィール編集の項目）so goToMissingField は案内だけ
    if (confEmployer) {
      checks.push(["受動喫煙の状況（プロフィールの「待遇」で設定）", !!(confEmployer.smoking_policy || "").trim(), null]);
      checks.push(["募集者の氏名・名称", !!(confEmployer.recruiter_name || "").trim(), null]);
      checks.push(["募集者の住所", !!(confEmployer.recruiter_address || "").trim(), null]);
      checks.push(["募集者の連絡先", !!(confEmployer.recruiter_contact || "").trim(), null]);
    }
    return checks.filter(([, ok]) => !ok).map(([label, , step]) => ({ label, step }));
  };
  // 足りない欄を伝えて、その欄のページへ送る（案内だけで終わらせない）。戻り先は確認ページ。
  // プロフィール由来の項目（step=null）しか無い時は案内だけ＝フロー内に行き先が無い
  const goToMissingField = (missing) => {
    alert("掲載前に以下の項目を入力してください：\n" + missing.map(m => "・" + m.label).join("\n"));
    const target = missing.find(m => m.step != null);
    if (!target) return;
    setReturnToConfirm(true);
    setStep(target.step);
  };
  const openPublish = () => {
    const missing = getPublishMissingFields();
    // 募集者の項目【だけ】が欠けている時は止めない＝掲載実行時のrecruitBox（新規登録の内容が
    // 初期値で入った入力ボックス）がその場で開く方が親切（2026-08-07）。他が混ざる時は一覧で知らせる
    const nonRecruiter = missing.filter(m => !m.label.startsWith("募集者"));
    if (nonRecruiter.length > 0) { goToMissingField(missing); return; }
    rememberFlowScroll();
    setPublishModal(true);
  };

  // ── OUTER SHELL ─────────────────────────────────────────────
  return (
    <div style={embedded ? { position:"relative", background:"#fff" } : { position:"fixed", inset:0, background:"#fff", zIndex:9998 }}>
      <DevBadge label="LandingFlow" />

      {/* 進捗バー */}
      {step > 0 && (
        <div style={{ position: embedded ? "relative" : "absolute", top:0, left:0, right:0, zIndex:1 }}>
          <div style={{ height:4, background:"#EBEBEB" }}>
            <div style={{ height:4, background:"#00A86B", width:((draftBarFull || step >= 12) ? 100 : (step/TOTAL*100))+"%", transition:"width 0.4s ease" }} />
          </div>
        </div>
      )}

      {/* 終了ボタン（押すと保存して終了／保存せずに終了／キャンセルの3択モーダルを開く） */}
      {!embedded && step !== 12 && step !== 11 && step !== 0 && step !== 6 && (
        <button onClick={() => setShowExitModal(true)} disabled={draftSaving} className="f-sans" style={{
          position:"absolute", top:`calc(${step > 0 ? 24 : 16}px + env(safe-area-inset-top, 0px))`, right:20,
          background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"8px 18px",
          fontSize:13, color:"#222", fontWeight:600, cursor:"pointer", zIndex:2,
          boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
        }}>{draftSaving ? "保存中..." : "終了"}</button>
      )}

      {/* 終了3択モーダル */}
      {showExitModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:28, maxWidth:360, width:"100%", boxShadow:"0 8px 40px rgba(0,0,0,0.15)" }}>
            <h3 className="f-sans" style={{ fontSize:18, fontWeight:700, color:"#222", marginBottom:20, textAlign:"center" }}>作成を終了しますか？</h3>
            <div style={{ display:"grid", gap:10 }}>
              <button onClick={() => { setShowExitModal(false); handleTopSave({ exit: true }); }} disabled={draftSaving} className="btn-primary" style={{ width:"100%", padding:"14px", fontSize:14, borderRadius:12 }}>保存して終了</button>
              <div>
                <button onClick={() => {
                  try { localStorage.removeItem('landingFlowDraft_v1'); localStorage.removeItem('postLoginReturnTo'); } catch {}
                  setShowExitModal(false);
                  window.location.hash = "/profile/employer";
                  if (typeof onSkip === "function") onSkip();
                }} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:14, borderRadius:12, background:"#fff", border:"1px solid #EBEBEB", color:"#222", cursor:"pointer" }}>保存せずに終了</button>
                <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", textAlign:"center", marginTop:6 }}>最後に「保存して終了」した内容は残ります</p>
              </div>
              <button onClick={() => setShowExitModal(false)} className="f-sans" style={{ width:"100%", padding:"10px", background:"none", border:"none", fontSize:13, color:"#717171", cursor:"pointer" }}>キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* スクロール領域（全stepスワイプで次へ/戻る・2026-07-16） */}
      <div ref={flowScrollRef} onTouchStart={onFlowTouchStart} onTouchEnd={onFlowTouchEnd} style={embedded ? {} : ((step === 0 || step === 6)
        ? { height:"100%", overflowY:"auto", display:"flex", flexDirection:"column", justifyContent:"center", ...flowScrollLock }
        : { height:"100%", overflowY:"auto", ...flowScrollLock })}>
        <div key={step} className={stepAnim || "fade-in"}
          onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && stepAnim.startsWith("step-in")) setStepAnim(""); }}
          style={{ maxWidth: (step === 11 || step === 0 || step === 6) ? 1280 : 480, margin:"0 auto", padding: embedded ? (step > 0 ? "16px 20px 24px" : "0 20px 24px") : (step > 0 ? "calc(64px + env(safe-area-inset-top, 0px)) 20px calc(76px + env(safe-area-inset-bottom, 0px))" : "calc(56px + env(safe-area-inset-top, 0px)) 20px 40px") }}>{/* 下余白は浮遊ピル(約66px)+10px（2026-07-16・旧140px）。上余白はblack-translucent対応でsafe-area加算（2026-07-31） */}

          {/* ── HOME ── */}
          {step === 0 && (
            <>
              <div className="step0-grid">
              <div>
              <div style={{ marginBottom:36 }}>
                <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 8px" }}>ステップ1</p>
                <h1 className="f-sans" style={{ fontSize:38, fontWeight:800, color:"#222", lineHeight:1.25, margin:"0 0 20px" }}>
                  {role === "farmer" ? "まず、基本情報から" : "あなたの希望を入力"}
                </h1>
                <p className="f-sans" style={{ fontSize:16, color:"#222", lineHeight:1.7, margin:0 }}>
                  {role === "farmer"
                    ? "求人に欠かせない情報を入力します。作物、作業内容、場所、日程、採用人数、報酬の6つを、ひとつずつうかがいます。"
                    : "はじめに、希望する作業内容や、働ける時期・条件についてうかがいます。次に、勤務できる地域、曜日、時間帯、希望する報酬など、お仕事探しに必要な情報をご入力ください。"}
                </p>
              </div>
              </div>
              {/* 見本求人カード（🥦ブロッコリー）は削除（2026-07-16）：既に求人が作られていると誤認されたため。憲法3条（表示にダミー禁止）とも整合 */}
              </div>
              <div style={{ position:"absolute", bottom:24, right:20, zIndex:2 }}>
                <button onClick={() => setStep(1)} className="btn-primary" style={{ padding:"14px 40px", fontSize:15, fontWeight:700 }}>次へ</button>
              </div>
            </>
          )}

          {/* ── FARMER FLOW ── */}
          {isFarmer && step === 1 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>作物を選んでください</h2>
            <p className="f-sans" style={lfStyles.subtitle}>募集する求人の作物を選びます。一覧にない場合は「その他」から入力できます。</p>
            <LFCropGrid
              options={CROP_OPTIONS}
              value={farmerCropPill}
              onSelect={v => {
                if (v === "__other__") { setFarmerCropPill("__other__"); }
                else { setFarmerCropPill(v); setFarmerCropText(""); }
              }}
              otherText={farmerCropText}
              onOtherChange={setFarmerCropText}
              otherPlaceholder="作物名を入力（例：ブロッコリー）"
            />
          </>)}

          {isFarmer && step === 2 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>作業内容を選んでください</h2>
            <p className="f-sans" style={lfStyles.subtitle}>募集する作業を選びます。一覧にない場合は「その他」から入力できます。</p>
            <LFCropGrid
              options={TASK_OPTIONS}
              noIcon
              value={farmerTaskPill}
              onSelect={v => {
                if (v === "__other__") { setFarmerTaskPill("__other__"); }
                else { setFarmerTaskPill(v); setFarmerTaskText(""); }
              }}
              otherText={farmerTaskText}
              onOtherChange={setFarmerTaskText}
              otherPlaceholder="作業名を入力（例：畝立て、マルチ張り）"
            />
          </>)}

          {isFarmer && step === 3 && (<>
            {/* 農家プロの作業場所ボックス（未設定時に⎘から展開・2026-07-16）。保存＝農家プロ＋この画面の両方へ反映 */}
            {placeBoxOpen && (
              <div onClick={()=>setPlaceBoxOpen(false)} onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} style={{ position:"fixed", inset:0, zIndex:700, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
                <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:480, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                    <button onClick={()=>setPlaceBoxOpen(false)} aria-label="閉じる" className="f-sans" style={{ width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:14, cursor:"pointer", flexShrink:0 }}>✕</button>
                    <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>📍 作業場所（農家プロフィール）</p>
                  </div>
                  <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:16 }}>
                    <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 12px", lineHeight:1.7 }}>プロフィールに作業場所が未設定です。保存すると、農家プロフィールとこの求人の集合場所の両方に入ります。</p>
                    <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>郵便番号</label>
                    <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                      <input value={pbZip} onChange={e=>{ setPbZip(e.target.value); setPbErr(""); }} placeholder="例：779-3401" className="field f-sans" style={{ flex:1, fontSize:14, marginBottom:0 }} />
                      <button onClick={searchPbZip} disabled={pbBusy} className="f-sans" style={{ padding:"0 14px", borderRadius:8, border:"1px solid #DADADA", background:"#fff", color:"#222", fontSize:12, fontWeight:600, cursor: pbBusy ? "default" : "pointer", whiteSpace:"nowrap" }}>{pbBusy ? "検索中..." : "住所を検索"}</button>
                    </div>
                    {pbErr && <p className="f-sans" style={{ fontSize:12, color:"#E53935", marginBottom:8 }}>{pbErr}</p>}
                    <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>都道府県</label>
                    <input value={pbPref} onChange={e=>setPbPref(e.target.value)} placeholder="例：徳島県" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:8 }} />
                    <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>市区町村</label>
                    <input value={pbCity} onChange={e=>setPbCity(e.target.value)} placeholder="例：吉野川市" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:8 }} />
                    <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>町域</label>
                    <input value={pbTown} onChange={e=>setPbTown(e.target.value)} placeholder="例：山川町〇〇" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:8 }} />
                    <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:4 }}>番地・建物名</label>
                    <input value={pbAddr} onChange={e=>setPbAddr(e.target.value)} placeholder="例：1-2-3 〇〇ハイツ101" className="field f-sans" style={{ width:"100%", fontSize:14, marginBottom:16 }} />
                    <button onClick={savePlaceBox} disabled={pbSaving || !pbCity.trim()} className="btn-primary f-sans" style={{ width:"100%", padding:"13px", fontSize:14, fontWeight:700, opacity: (pbSaving || !pbCity.trim()) ? 0.5 : 1 }}>{pbSaving ? "保存中..." : "保存する"}</button>
                  </div>
                </div>
              </div>
            )}
            {/* ⎘＝作業場所の復元マーク（2026-07-16）：緑地×白マーク・見出し行の右端（カード内の「住所を検索」との重なり回避）。
                プロフィール設定済み=タップで復元／未設定=タップで作業場所の入力ボックスを展開（保存で農家プロ＋この画面の両方へ反映） */}
            <div style={{ position:"relative", paddingRight:44 }}>
              <h2 className="f-sans" style={lfStyles.stepTitle}>集合場所を入力してください</h2>
              <button onClick={() => {
                if (prevAddress) {
                  setFarmerZip(prevAddress.zip || "");
                  setFarmerPref(prevAddress.prefecture || "");
                  setFarmerCity(prevAddress.city || "");
                  setFarmerTown(prevAddress.town || "");
                  setFarmerAddr(prevAddress.address || "");
                  setFarmerRegion((prevAddress.prefecture || "") + (prevAddress.city || "") + (prevAddress.town || ""));
                  setZipError("");
                } else {
                  setPbZip(farmerZip); setPbPref(farmerPref); setPbCity(farmerCity); setPbTown(farmerTown); setPbAddr(farmerAddr);
                  setPbErr("");
                  setPlaceBoxOpen(true);
                }
              }} aria-label="作業場所を復元" className="f-sans" style={{ position:"absolute", top:0, right:0, zIndex:1, width:36, height:36, borderRadius:"50%", border:"none", background:"#00A86B", fontSize:16, fontWeight:700, color:"#fff", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>⎘</button>
            </div>
            <p className="f-sans" style={lfStyles.subtitle}>集合場所の住所を入力します。</p>
            {/* 説明の一本化（2026-08-08たきと指示）：欄ごとに散らばっていた注記（自動入力・町域まで公開・
                番地は会員のみ・プライバシー）をこの1箇所に集約。「はじめてOKとは？」と同じ〜とは？形式。
                開示の実態はDBが正（jobs_public：町域・番地はanonマスク・2026-08-03） */}
            <button type="button" onClick={() => setPlaceInfoOpen(v => !v)} className="f-sans" style={{ background:"none", border:"none", padding:"0 0 8px", fontSize:13, color:"#00A86B", textDecoration:"underline", cursor:"pointer" }}>集合場所の公開範囲とは？</button>
            {placeInfoOpen && (
              <div className="f-sans" style={{ fontSize:13, color:"#0B6B4F", background:"#F0F7F4", border:"1px solid #CDE9DD", borderRadius:8, padding:"10px 12px", margin:"0 0 12px", lineHeight:1.8 }}>
                <p style={{ margin:0 }}>・郵便番号を入れると、都道府県・市区町村は自動で入ります。違っているときは郵便番号を直してください</p>
                <p style={{ margin:0 }}>・町域までの住所は、求人ページで誰でも見られます</p>
                <p style={{ margin:0 }}>・番地・建物名は、ログインした利用者にだけ表示されます（未ログインの訪問者には伏せ字になります）</p>
                <p style={{ margin:0 }}>・最寄り駅からの移動時間は任意です。書くと働き手が通えるか判断しやすくなります</p>
                <p style={{ margin:0 }}>・本名・電話番号がこのページから公開されることはありません</p>
              </div>
            )}

            <LFWizCard>
              <div>
                <label className="f-sans" style={lfStyles.inputLabel}>郵便番号</label>
                <div style={{ display:"flex", gap:8, alignItems:"stretch", marginBottom:8 }}>
                  <input
                    ref={zipRef}
                    value={farmerZip}
                    onChange={e => {
                      const v = e.target.value;
                      setFarmerZip(v);
                      // 7桁打ち終わった時だけ自動検索（復元処理では走らない・上のコメント参照）
                      if (v.replace(/[^0-9]/g, "").length === 7) searchZip(v);
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchZip(); } }}
                    placeholder="例：779-3401"
                    className="field f-sans"
                    style={{ fontSize:16, flex:1, marginBottom:0 }}
                  />
                  {/* onClick={searchZip} と書かないこと：Reactがイベントを第1引数で渡すため、
                      それが郵便番号として解釈されてしまう（searchZipは引数を取るようになった） */}
                  <button onClick={() => searchZip()} disabled={zipSearching} className="f-sans" style={{
                    padding:"0 16px", borderRadius:8, border:"1px solid #DADADA",
                    background:"#fff", color:"#222", fontSize:13, fontWeight:600,
                    cursor: zipSearching ? "default" : "pointer", whiteSpace:"nowrap",
                  }}>{zipSearching ? "検索中..." : "住所を検索"}</button>
                </div>
                {zipError && <p className="f-sans" style={{ fontSize:14, color:"#E53935", marginBottom:12 }}>{zipError}</p>}
                <label className="f-sans" style={lfStyles.inputLabel}>都道府県</label>
                <input
                  ref={prefRef}
                  value={farmerPref}
                  readOnly
                  placeholder="例：徳島県"
                  className="field f-sans"
                  style={{ fontSize:16, marginBottom:12, background:"#F7F7F7", color:"#717171", cursor:"not-allowed" }}
                />
                <label className="f-sans" style={lfStyles.inputLabel}>市区町村</label>
                <input
                  ref={cityRef}
                  value={farmerCity}
                  readOnly
                  placeholder="例：吉野川市"
                  className="field f-sans"
                  style={{ fontSize:16, marginBottom:12, background:"#F7F7F7", color:"#717171", cursor:"not-allowed" }}
                />
                <label className="f-sans" style={lfStyles.inputLabel}>町域</label>
                <input
                  ref={townRef}
                  value={farmerTown}
                  onChange={e => { setFarmerTown(e.target.value); setFarmerRegion(farmerPref + farmerCity + e.target.value); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addrRef.current?.focus(); } }}
                  placeholder="例：山川町〇〇"
                  className="field f-sans"
                  style={{ fontSize:16, marginBottom:12 }}
                />
                <label className="f-sans" style={lfStyles.inputLabel}>番地・建物名</label>
                <input
                  ref={addrRef}
                  value={farmerAddr}
                  onChange={e => setFarmerAddr(e.target.value)}
                  onKeyDown={(e) => {
                    // 最後の欄の確定＝次の入力先（次のステップ）へ自動遷移。未入力が残っていればキーボードを閉じるだけ
                    if (e.key === "Enter") { e.preventDefault(); if (canGoNext) goNext(); else e.currentTarget.blur(); }
                  }}
                  placeholder="例：1-2-3 〇〇ハイツ101"
                  className="field f-sans"
                  style={{ fontSize:16 }}
                />
                {(!farmerZip.trim() || !farmerPref.trim() || !farmerCity.trim() || !farmerTown.trim() || !farmerAddr.trim()) && <p className="f-sans" style={{ fontSize:14, color:"#F5A623", marginTop:4 }}>すべての住所欄を入力してください</p>}
                {prefNotAllowed && (
                  <p className="f-sans" style={{ fontSize:14, color:"#E24B4A", marginTop:4 }}>
                    現在、徳島県内の求人のみ受け付けています。他の地域への展開は準備中です
                  </p>
                )}
                {/* 5-c. 最寄り駅からの移動時間 */}
                <div style={{ marginBottom:14 }}>
                  <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>最寄り駅からの移動時間</label>
                  <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                    <input value={nearestStation} onChange={e => setNearestStation(e.target.value)} placeholder="例：阿波山川" className="field f-sans" style={{ fontSize:14, maxWidth:160 }} />
                    <span className="f-sans" style={{ fontSize:13, color:"#717171" }}>駅から</span>
                    <select value={commuteTime} onChange={e => setCommuteTime(e.target.value)} className="field f-sans" style={{ fontSize:14, maxWidth:160 }}>
                      <option value="">選択してください</option>
                      <option value="徒歩5分以内">徒歩5分以内</option>
                      <option value="徒歩10分以内">徒歩10分以内</option>
                      <option value="車5分以内">車5分以内</option>
                      <option value="車10分以内">車10分以内</option>
                      <option value="車20分以内">車20分以内</option>
                    </select>
                  </div>
                </div>
              </div>
            </LFWizCard>
            {/* LFPrivacyNote は削除（2026-08-08）：内容は上の「集合場所の公開範囲とは？」に統合 */}
          </>)}

                    {/* ── 農家 Step3: 詳細入力 ── */}
          {isFarmer && step === 4 && farmerPurpose === "post" && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>採用人数と作業日程を入力してください</h2>
            <p className="f-sans" style={lfStyles.subtitle}>何人募集するか、いつ作業を行うかを入力します。</p>
            <LFWizCard>
              {/* 5. 採用人数 */}
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>採用人数</label>
                <input type="number" value={jobCount} onChange={e => setJobCount(e.target.value)} placeholder="例：3" className="field f-mono" style={{ fontSize:16, maxWidth:100 }} />
              </div>
              {/* 3. 開催日（カレンダー） */}
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>作業日程</label>
                <button
                  onClick={() => setShowCalendar(v => !v)}
                  style={{
                    width:"100%", textAlign:"left", padding:"12px 14px", borderRadius:12,
                    border:"1px solid", borderColor: jobDateStart ? "#00A86B" : "#EBEBEB",
                    background:"#fff", fontSize:13, cursor:"pointer", color: jobDateStart ? "#222" : "#B0B0B0", fontFamily:"inherit",
                  }}
                >{jobDateLabel}</button>
                {showCalendar && <CalendarView start={jobDateStart} end={jobDateEnd} readOnly={false} holidays={jobHolidays} onSelect={(dt) => {
                  // 休日設定モード（2026-08-03）：タップ＝休日トグル。開始日・終了日・期間外は休日にできない
                  if (holidayMode && jobDateStart && jobDateEnd) {
                    const ymd = ymdLocal(dt);
                    const s = ymdLocal(jobDateStart), e = ymdLocal(jobDateEnd);
                    if (ymd <= s || ymd >= e) return;
                    setJobHolidays(prev => prev.includes(ymd) ? prev.filter(x => x !== ymd) : [...prev, ymd].sort());
                    return;
                  }
                  if (!jobDateStart || jobDateEnd) { setJobDateStart(dt); setJobDateEnd(null); }
                  else if (dt >= jobDateStart) { setJobDateEnd(dt); }
                  else { setJobDateStart(dt); setJobDateEnd(null); }
                }} />}
                {/* 休日設定（2026-08-03たきと指示）：期間（開始日≠終了日）が決まったら表示。
                    ボタンで休日モードに入り、カレンダーの日をタップして休日を置く。もう一度ボタンで完了 */}
                {showCalendar && jobDateStart && jobDateEnd && ymdLocal(jobDateStart) !== ymdLocal(jobDateEnd) && (
                  <div style={{ marginTop:8 }}>
                    <button onClick={() => setHolidayMode(v => !v)} className="f-sans" style={{ width:"100%", padding:"11px", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer", border:"1px solid #00A86B", background: holidayMode ? "#00A86B" : "#fff", color: holidayMode ? "#fff" : "#00A86B" }}>
                      {holidayMode ? "✓ 休日の設定を完了する" : "休日を設定する"}
                    </button>
                    {holidayMode && (
                      <p className="f-sans" style={{ fontSize:12, color:"#0B6B4F", background:"#F0F7F4", border:"1px solid #CDE9DD", borderRadius:8, padding:"8px 10px", marginTop:6, lineHeight:1.6 }}>
                        カレンダーの日をタップすると休日になります（もう一度タップで解除）。開始日・終了日は休日にできません。
                      </p>
                    )}
                    {jobHolidays.length > 0 && !holidayMode && (
                      <p className="f-sans" style={{ fontSize:12, color:"#717171", marginTop:6 }}>休日：{jobHolidays.length}日（グレーの打ち消し線の日）</p>
                    )}
                  </div>
                )}
              </div>
            </LFWizCard>
          </>)}

          {/* ── 農家 Step3: オファー側詳細 ── */}
          {isFarmer && step === 4 && farmerPurpose === "offer" && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>候補者リスト（想定画面）</h2>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:12 }}>作業内容・経験・勤務条件を見える化し、ミスマッチを減らすUI（構想）</p>
            <LFFakeFilterRow />
            {[
              { name:"A. T.", crop:"トマト・キュウリ", work:"収穫・定植",       exp:"4〜10年",  hourly:1200 },
              { name:"K. N.", crop:"イチゴ",           work:"収穫・選果",       exp:"1〜3年",   hourly:1100 },
              { name:"S. M.", crop:"米・大豆",         work:"草刈り・農薬散布", exp:"10年以上", hourly:1300 },
            ].map((c, i) => (
              <div key={i} style={{ padding:"14px 16px", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, marginBottom:10 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                  <div style={{ width:40, height:40, borderRadius:"50%", background:"#E6F7EF", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>👤</div>
                  <div style={{ flex:1 }}>
                    <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222" }}>{c.name}</p>
                    <p className="f-sans" style={{ fontSize:11, color:"#717171" }}>{c.exp}</p>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <p className="f-mono" style={{ fontSize:14, fontWeight:700, color:"#00A86B" }}>¥{c.hourly.toLocaleString()}/h</p>
                    {AVG_COUNT >= 5 && (
                      <p className="f-sans" style={{ fontSize:10, color: c.hourly>=AVG_HOURLY ? "#00A86B" : "#F5A623" }}>平均{c.hourly>=AVG_HOURLY?"+":""}{(c.hourly-AVG_HOURLY).toLocaleString()}円</p>
                    )}
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {[c.crop, c.work].map(t => <span key={t} style={{ padding:"2px 9px", borderRadius:20, background:"#F7F7F7", color:"#717171", fontSize:11 }}>{t}</span>)}
                </div>
              </div>
            ))}
          </>)}

          {/* ── 農家 step5: 採用人数（骨格・中身は段階Bで移植） ── */}
          {isFarmer && step === 5 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>勤務条件を入力してください</h2>
            <p className="f-sans" style={lfStyles.subtitle}>働く時間と報酬を入力します。金額に迷ったら、表示される地域の相場を参考にできます。無理のない範囲で、働き手に選ばれやすい条件を整えましょう。</p>
            <LFWizCard>
              {/* 4. 勤務時間（input type=time・iPhoneタイマー型） */}
              {(() => {
                const timeStyle = { height:48, borderRadius:12, border:"1px solid #EBEBEB", background:"#FFFFFF", color:"#222222", fontSize:16, fontWeight:700, textAlign:"center", padding:"0 10px", outline:"none", cursor:"pointer" };
                const rowStyle = { display:"flex", alignItems:"center", justifyContent:"center", gap:10, flexWrap:"wrap", marginTop:12 };
                const toTime = (h, m) => `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
                const fromTime = (val, setH, setM) => {
                  if (!val) return;
                  const [h, m] = val.split(":");
                  setH(String(Number(h)));
                  setM(m);
                };
                return (
                  <div style={{ marginBottom:14 }}>
                    <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:4 }}>勤務時間</label>
                    <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginBottom:0 }}>開始時間と終了時間を選んでください。</p>
                    <div style={rowStyle}>
                      <input type="time" value={toTime(startHour, startMinute)} onChange={e => fromTime(e.target.value, setStartHour, setStartMinute)} style={timeStyle} />
                      <span style={{ margin:"0 6px", color:"#717171", fontWeight:700, fontSize:16 }}>〜</span>
                      <input type="time" value={toTime(endHour, endMinute)} onChange={e => fromTime(e.target.value, setEndHour, setEndMinute)} style={timeStyle} />
                    </div>
                    <p className="f-sans" style={{ fontSize:14, color:"#00A86B", marginTop:8, textAlign:"center" }}>→ {workTimeLabel}</p>
                  </div>
                );
              })()}
              {/* 時間外労働（2026-08-03たきと指示「必須。勤務時間設定の下に」）：
                  所定の勤務時間を超える労働の有無は労働条件の明示事項so必須（farmerCanNext[5]でも判定）。
                  「あり」のときは目安の時間も必須＝有無だけでなく「どれくらいか」まで明記させる。
                  説明はタイトル横の？をタップで展開（2026-08-07たきと指示・常時表示をやめ画面を軽く） */}
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>
                  時間外労働
                  <button type="button" onClick={() => setOvertimeInfoOpen(v => !v)} aria-label="時間外労働の説明"
                    style={{ marginLeft:6, width:18, height:18, borderRadius:"50%", border:"1px solid " + (overtimeInfoOpen ? "#00A86B" : "#C8C8C8"), background: overtimeInfoOpen ? "#00A86B" : "#fff", color: overtimeInfoOpen ? "#fff" : "#999", fontSize:11, fontWeight:700, lineHeight:1, cursor:"pointer", padding:0, verticalAlign:"middle" }}>？</button>
                </label>
                {overtimeInfoOpen && (
                  <p className="f-sans" style={{ fontSize:13, color:"#0B6B4F", background:"#F0F7F4", border:"1px solid #CDE9DD", borderRadius:8, padding:"8px 10px", margin:"0 0 8px", lineHeight:1.7 }}>
                    上の勤務時間を超えて作業をお願いすることがあるかどうかです。働き手がその日の予定を立てるために見ています。
                  </p>
                )}
                <LFPillSelect options={OVERTIME_OPTIONS} value={overtimePolicy} onSelect={setOvertimePolicy} />
                {overtimePolicy === "あり" && (<>
                  <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", margin:"8px 0 6px" }}>どれくらいの時間ですか</label>
                  <input value={overtimeDetail} onChange={e => setOvertimeDetail(e.target.value)} placeholder="例：繁忙期は1日30分〜1時間程度" maxLength={100} className="field f-sans" style={{ fontSize:16 }} />
                </>)}
                {!overtimePolicy && <p className="f-sans" style={{ fontSize:14, color:"#F5A623", marginTop:6 }}>時間外労働の有無を選んでください</p>}
                {overtimePolicy === "あり" && !overtimeDetail.trim() && <p className="f-sans" style={{ fontSize:14, color:"#F5A623", marginTop:6 }}>どれくらいの時間かを入力してください</p>}
              </div>

              {/* 5-b. 休憩時間（グループ2予定） */}
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>休憩時間</label>
                <select value={breakTime} onChange={e => setBreakTime(e.target.value)} className="field f-sans" style={{ fontSize:14, maxWidth:160 }}>
                  <option value="">選択してください</option>
                  <option value="なし">なし</option>
                  {/* 5分刻み（2026-07-16）。値は従来と同じ「N分」形式＝既存データ（30分/60分等）とそのまま互換 */}
                  {Array.from({ length: 24 }, (_, i) => (i + 1) * 5).map(m => (
                    <option key={m} value={`${m}分`}>{m}分</option>
                  ))}
                </select>
              </div>
              {/* 6. 報酬 */}
              <div style={{ marginBottom:6 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:4 }}>報酬</label>
              </div>
              {/* 時給欄は削除（2026-07-16・日給に一本化）。変数hourlyWageInput・保存経路・最賃チェックは
                  既存下書きの復元と表示のため温存（UIのみ撤去） */}
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:6 }}>日給 <span style={{ fontSize:11, color:"#B0B0B0" }}>（円）</span></label>
                <input inputMode="numeric" value={dailyWageInput} onChange={e => setDailyWageInput(e.target.value.replace(/[^\d]/g, ""))} placeholder="例：9000" className="field f-mono" style={{ fontSize:18, maxWidth:160 }} />
                <LFWageCompare type="日給" value={dailyWage} avg={AVG_DAILY} count={AVG_COUNT} />
                {dailyViolation && (
                  <p className="f-sans" style={{ fontSize:14, color:"#E24B4A", marginTop:6 }}>{farmerPref || "この地域"}の最低賃金（時給{minWage ? minWage.toLocaleString() : "―"}円）を下回っています。この金額では掲載できません</p>
                )}
                {unknownWage && (hourlyWage > 0 || dailyWage > 0) && (
                  <p className="f-sans" style={{ fontSize:14, color:"#E24B4A", marginTop:6 }}>
                    この地域の最低賃金データが未登録のため、金額を確認できません。運営にお問い合わせください
                  </p>
                )}
              </div>
              {/* 支払いタイミング・支払方法の入力UIは封印中（解禁禁止・2026-08-02確認）。
                  支払条件は固定ポリシー（各作業日の作業終了後・現金手渡し）として掲載申請時に
                  jobsへ確定保存される（trg_job_publish_snapshot）。下の選択肢のうち
                  「週末まとめ払い」「月末締め・翌月払い」「銀行振込」「相談して決める」は
                  正式な選択肢として扱わない＝解禁時は締切日・支払日・同意処理を含めて別途設計する。
                  特に「相談して決める」は契約成立時に支払方法が未確定のまま残るため復活させないこと */}
              {false && (
              <div style={{ marginBottom:14, marginTop:14 }}>
                <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:6 }}>支払いタイミング</label>
                <LFPillSelect options={["即日払い（作業当日）","週末まとめ払い","月末締め・翌月払い"]} value={payTiming} onSelect={setPayTiming} />
              </div>
              )}
              {false && (
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, color:"#222", display:"block", marginBottom:6 }}>支払方法</label>
                <LFPillSelect options={["現金手渡し","銀行振込","相談して決める"]} value={payMethod} onSelect={setPayMethod} />
              </div>
              )}
            </LFWizCard>
          </>)}

          {/* ── 農家 step6: グループ2 説明ページ（step0と同じ2カラム構造） ── */}
          {isFarmer && step === 6 && (<>
            <div className="step0-grid">
              <div>
                <div style={{ marginBottom:36 }}>
                  <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#00A86B", margin:"0 0 8px" }}>ステップ2</p>
                  <h1 className="f-sans" style={{ fontSize:38, fontWeight:800, color:"#222", lineHeight:1.25, margin:"0 0 20px" }}>ここからは任意です</h1>
                  <p className="f-sans" style={{ fontSize:16, color:"#222", lineHeight:1.7, margin:0 }}>ここから先は、入力しなくても求人を出せます。ですが、写真や作業の詳しい説明、勤務条件などを加えると、働き手が「ここで働きたい」と感じやすくなります。あなたの求人を、もっと魅力的にしましょう。</p>
                </div>
              </div>
              {/* 📸見本カードは削除（2026-07-16）：step0の見本カードと同じく、実在の求人と誤認されうるため */}
            </div>
            <div style={{ display:"flex", justifyContent:"flex-end", marginTop:24 }}>
              {!returnToConfirm && (
                <button onClick={() => setStep(11)} className="f-sans" style={{ padding:"12px 28px", fontSize:14, fontWeight:700, background:"#fff", border:"1px solid #00A86B", borderRadius:12, color:"#00A86B", cursor:"pointer" }}>あとで書く — 確認画面へ進む →</button>
              )}
            </div>
          </>)}

          {/* ── 農家 step7: 写真 ── */}
          {isFarmer && step === 7 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>写真</h2>
            <p className="f-sans" style={lfStyles.subtitle}>最初の1枚が、働き手が最初に目にする「顔」になります。畑の全景・作業の様子・収穫物が伝わる写真ほど、応募が増えます。（最大10枚・1枚目がカバー写真になります）</p>
            <LFWizCard>
                  {/* アップロードボタン（multiple・残り枠まで直列処理） */}
                  <div style={{ marginBottom: jobPhotos.length > 0 ? 16 : 0 }}>
                    <label className="f-sans btn-primary" style={{ display:"inline-block", padding:"12px 24px", fontSize:14, fontWeight:700, cursor: photoUploading ? "wait" : "pointer", opacity: (photoUploading || jobPhotos.length >= 10) ? 0.5 : 1 }}>
                      {photoUploading ? "アップロード中..." : "＋ 写真を追加"}
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display:"none" }} disabled={photoUploading || jobPhotos.length >= 10} onChange={async e => {
                        const files = Array.from(e.target.files || []);
                        if (files.length === 0) return;
                        const room = 10 - jobPhotos.length;
                        const queue = files.slice(0, room);
                        setPhotoUploading(true);
                        // 全ファイルを並列アップロード（各ファイル内も原寸＋サムネを並列・デコード1回）
                        const results = await Promise.all(queue.map(file =>
                          uploadJobPhoto(supabase, file).catch(err => { console.error('photo upload failed', file.name, err); return null; })
                        ));
                        const uploaded = results.filter(r => r && r.url).map(r => ({ caption: "", ...r }));
                        if (uploaded.length > 0) setJobPhotos(prev => [...prev, ...uploaded]);
                        if (uploaded.length < queue.length) {
                          alert(`${queue.length - uploaded.length}枚のアップロードに失敗しました。通信環境を確認して、もう一度お試しください。`);
                        }
                        setPhotoUploading(false);
                        e.target.value = '';
                      }} />
                    </label>
                    <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginTop:8 }}>{jobPhotos.length} / 10 枚</p>
                  </div>

                  {/* 空状態：大タップゾーン */}
                  {jobPhotos.length === 0 && (
                    <label className="f-sans" style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, padding:"48px 24px", border:"2px dashed #D8D8D8", borderRadius:16, cursor: photoUploading ? "wait" : "pointer", background:"#FAFAFA", textAlign:"center" }}>
                      <span style={{ fontSize:44, lineHeight:1 }}>📷</span>
                      <span className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222" }}>写真をドロップ、またはタップして追加</span>
                      <span className="f-sans" style={{ fontSize:14, color:"#B0B0B0", maxWidth:280, lineHeight:1.6 }}>畑の全景・作業の様子・収穫物が伝わる写真ほど、応募が増えます。1枚目がカバー写真になります。</span>
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display:"none" }} disabled={photoUploading} onChange={async e => {
                        const files = Array.from(e.target.files || []);
                        if (files.length === 0) return;
                        const queue = files.slice(0, 10);
                        setPhotoUploading(true);
                        // 全ファイルを並列アップロード（各ファイル内も原寸＋サムネを並列・デコード1回）
                        const results = await Promise.all(queue.map(file =>
                          uploadJobPhoto(supabase, file).catch(err => { console.error('photo upload failed', file.name, err); return null; })
                        ));
                        const uploaded = results.filter(r => r && r.url).map(r => ({ caption: "", ...r }));
                        if (uploaded.length > 0) setJobPhotos(prev => [...prev, ...uploaded]);
                        if (uploaded.length < queue.length) {
                          alert(`${queue.length - uploaded.length}枚のアップロードに失敗しました。通信環境を確認して、もう一度お試しください。`);
                        }
                        setPhotoUploading(false);
                        e.target.value = '';
                      }} />
                    </label>
                  )}

                  {/* 追加後：カバー大・以降小グリッド */}
                  {jobPhotos.length > 0 && (
                    <div>
                      <div style={{ position:"relative", marginBottom:10 }}>
                        <img loading="lazy" src={photoThumb(jobPhotos[0])} alt="カバー写真" style={{ width:"100%", height:260, objectFit:"cover", borderRadius:14, border:"1px solid #EEE" }} />
                        <span className="f-sans" style={{ position:"absolute", top:10, left:10, padding:"4px 12px", background:"rgba(0,0,0,0.65)", color:"#fff", fontSize:12, fontWeight:700, borderRadius:8 }}>カバー</span>
                        <button onClick={() => setJobPhotos(prev => prev.filter((_, j) => j !== 0))} style={{ position:"absolute", top:8, right:8, width:28, height:28, borderRadius:"50%", border:"none", background:"rgba(0,0,0,0.65)", color:"#fff", fontSize:15, cursor:"pointer", lineHeight:1 }}>×</button>
                      </div>
                      {/* 2枚目以降は2列の大サイズ（2026-07-16）。justifyContent:centerで奇数枚の最後の1枚＝空白が中央に来る */}
                      {jobPhotos.length > 1 && (
                        <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center" }}>
                          {jobPhotos.slice(1).map((p, i) => {
                            const idx = i + 1;
                            return (
                              <div key={idx} style={{ position:"relative", width:"calc(50% - 4px)" }}>
                                <img loading="lazy" src={photoThumb(p)} alt={`写真${idx+1}`} style={{ width:"100%", aspectRatio:"4 / 3", objectFit:"cover", borderRadius:10, border:"1px solid #EEE", display:"block" }} />
                                <button onClick={() => setJobPhotos(prev => prev.filter((_, j) => j !== idx))} style={{ position:"absolute", top:-6, right:-6, width:22, height:22, borderRadius:"50%", border:"none", background:"#222", color:"#fff", fontSize:12, cursor:"pointer", lineHeight:1 }}>×</button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </LFWizCard>
          </>)}

          {/* ── 農家 step8: 作業説明文 ── */}
          {isFarmer && step === 8 && (<>
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
            <button onClick={()=>setPhotoCaptionsOpen(false)} aria-label="閉じる" className="f-sans" style={{ width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:14, cursor:"pointer", flexShrink:0 }}>✕</button>
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

          </>)}

          {/* ── 農家 step10: 危険箇所 ── */}
          {isFarmer && step === 9 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>危険な作業・場所</h2>
            <p className="f-sans" style={lfStyles.subtitle}>危険な場所や作業を入力できます。写真や補足説明を添えると、より正確に伝わります。安心して働けるよう、気になる危険は正直に伝えましょう。</p>
            <LFWizCard>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>危険な場所（任意）</label>
                <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginBottom:8 }}>働き手に事前に知らせたい危険な場所があれば入力してください。</p>
                {jobDangerPlaces.slice(0, showPlace2 ? 2 : 1).map((place, i) => (
                  <div key={i} style={{ marginBottom:8 }}>
                    <input value={place.label} onChange={e => setJobDangerPlaces(prev => prev.map((p, j) => j === i ? { ...p, label: e.target.value } : p))} placeholder={`危険な場所${i + 1}（例：ぬかるみ）`} className="field f-sans" style={{ fontSize:14, marginBottom:4 }} />
                    <input value={place.desc} onChange={e => setJobDangerPlaces(prev => prev.map((p, j) => j === i ? { ...p, desc: e.target.value } : p))} placeholder="補足説明（例：雨上がりは特に滑りやすい）" className="field f-sans" style={{ fontSize:13 }} />
                        <div style={{ display:"flex", gap:8, marginTop:6 }}>
                          {[0,1].map(k => {
                            const ph = place.photos?.[k];
                            return ph ? (
                              <div key={k} style={{ position:"relative", flex:1, height:90, borderRadius:10, overflow:"hidden", border:"1px solid #EEE" }}>
                                <img loading="lazy" src={ph.url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                                <button onClick={() => setJobDangerPlaces(prev => prev.map((p, j) => j === i ? { ...p, photos: p.photos.filter((_, x) => x !== k) } : p))} style={{ position:"absolute", top:4, right:4, width:22, height:22, borderRadius:"50%", border:"none", background:"rgba(0,0,0,0.65)", color:"#fff", fontSize:12, cursor:"pointer", lineHeight:1 }}>×</button>
                              </div>
                            ) : (
                              <label key={k} style={{ flex:1, height:90, border:"2px dashed #D8D8D8", borderRadius:10, background:"#FAFAFA", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3, cursor:"pointer" }}>
                                <span style={{ fontSize:22, lineHeight:1, opacity:0.6 }}>📷</span>
                                <span className="f-sans" style={{ fontSize:10, color:"#B0B0B0" }}>写真を追加</span>
                                <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display:"none" }} onChange={async e => {
                                  const files = Array.from(e.target.files || []);
                                  if (files.length === 0) return;
                                  const room = 2 - (place.photos?.length || 0);
                                  const queue = files.slice(0, room);
                                  const results = await Promise.all(queue.map(file =>
                                    uploadJobPhoto(supabase, file, { pathPrefix: 'danger_', withThumb: false }).catch(err => { console.error('danger photo upload failed', err); return null; })
                                  ));
                                  const uploaded = results.filter(r => r && r.url).map(r => ({ url: r.url }));
                                  if (uploaded.length > 0) setJobDangerPlaces(prev => prev.map((p, j) => j === i ? { ...p, photos: [...(p.photos||[]), ...uploaded] } : p));
                                  if (uploaded.length < queue.length) { alert('一部の写真のアップロードに失敗しました。もう一度お試しください。'); }
                                  e.target.value = '';
                                }} />
                              </label>
                            );
                          })}
                        </div>
                  </div>
                ))}
                    {!showPlace2 ? (
                      <button onClick={() => setShowPlace2(true)} className="f-sans" style={{ background:"none", border:"1px dashed #C8C8C8", borderRadius:10, padding:"10px", width:"100%", fontSize:13, color:"#00A86B", cursor:"pointer", fontWeight:600 }}>＋ 危険な場所をもう1つ追加</button>
                    ) : (
                      <button onClick={() => { setShowPlace2(false); setJobDangerPlaces(prev => prev.map((p, j) => j === 1 ? { ...p, label:"", desc:"", photos:[] } : p)); }} className="f-sans" style={{ background:"none", border:"none", padding:"6px", fontSize:12, color:"#B0B0B0", cursor:"pointer" }}>× 2つ目を削除</button>
                    )}
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>危険な作業（任意）</label>
                <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginBottom:8 }}>働き手に事前に知らせたい危険な作業があれば入力してください。</p>
                {jobDangerTasks.slice(0, showTask2 ? 2 : 1).map((task, i) => (
                  <div key={i} style={{ marginBottom:8 }}>
                    <input value={task.label} onChange={e => setJobDangerTasks(prev => prev.map((t, j) => j === i ? { ...t, label: e.target.value } : t))} placeholder={`危険な作業${i + 1}（例：重いコンテナの運搬）`} className="field f-sans" style={{ fontSize:14, marginBottom:4 }} />
                    <input value={task.desc} onChange={e => setJobDangerTasks(prev => prev.map((t, j) => j === i ? { ...t, desc: e.target.value } : t))} placeholder="補足説明（例：腰を痛めないよう正しい持ち方が必要）" className="field f-sans" style={{ fontSize:13 }} />
                        <div style={{ display:"flex", gap:8, marginTop:6 }}>
                          {[0,1].map(k => {
                            const ph = task.photos?.[k];
                            return ph ? (
                              <div key={k} style={{ position:"relative", flex:1, height:90, borderRadius:10, overflow:"hidden", border:"1px solid #EEE" }}>
                                <img loading="lazy" src={ph.url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                                <button onClick={() => setJobDangerTasks(prev => prev.map((t, j) => j === i ? { ...t, photos: t.photos.filter((_, x) => x !== k) } : t))} style={{ position:"absolute", top:4, right:4, width:22, height:22, borderRadius:"50%", border:"none", background:"rgba(0,0,0,0.65)", color:"#fff", fontSize:12, cursor:"pointer", lineHeight:1 }}>×</button>
                              </div>
                            ) : (
                              <label key={k} style={{ flex:1, height:90, border:"2px dashed #D8D8D8", borderRadius:10, background:"#FAFAFA", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3, cursor:"pointer" }}>
                                <span style={{ fontSize:22, lineHeight:1, opacity:0.6 }}>📷</span>
                                <span className="f-sans" style={{ fontSize:10, color:"#B0B0B0" }}>写真を追加</span>
                                <input type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display:"none" }} onChange={async e => {
                                  const files = Array.from(e.target.files || []);
                                  if (files.length === 0) return;
                                  const room = 2 - (task.photos?.length || 0);
                                  const queue = files.slice(0, room);
                                  const results = await Promise.all(queue.map(file =>
                                    uploadJobPhoto(supabase, file, { pathPrefix: 'danger_', withThumb: false }).catch(err => { console.error('danger photo upload failed', err); return null; })
                                  ));
                                  const uploaded = results.filter(r => r && r.url).map(r => ({ url: r.url }));
                                  if (uploaded.length > 0) setJobDangerTasks(prev => prev.map((t, j) => j === i ? { ...t, photos: [...(t.photos||[]), ...uploaded] } : t));
                                  if (uploaded.length < queue.length) { alert('一部の写真のアップロードに失敗しました。もう一度お試しください。'); }
                                  e.target.value = '';
                                }} />
                              </label>
                            );
                          })}
                        </div>
                  </div>
                ))}
                    {!showTask2 ? (
                      <button onClick={() => setShowTask2(true)} className="f-sans" style={{ background:"none", border:"1px dashed #C8C8C8", borderRadius:10, padding:"10px", width:"100%", fontSize:13, color:"#00A86B", cursor:"pointer", fontWeight:600 }}>＋ 危険な作業をもう1つ追加</button>
                    ) : (
                      <button onClick={() => { setShowTask2(false); setJobDangerTasks(prev => prev.map((t, j) => j === 1 ? { ...t, label:"", desc:"", photos:[] } : t)); }} className="f-sans" style={{ background:"none", border:"none", padding:"6px", fontSize:12, color:"#B0B0B0", cursor:"pointer" }}>× 2つ目を削除</button>
                    )}
              </div>
            </LFWizCard>
          </>)}

          {/* ── 農家 step11: 持ち物・備考＋必要経験 ── */}
          {isFarmer && step === 10 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>働き手への希望</h2>
            <p className="f-sans" style={lfStyles.subtitle}>持ち物や注意事項、求める経験など、働き手に伝えておきたいことを入力できます。作業に必要な道具や安全への備えは、受け入れる農家側でご用意・ご対応ください。（すべて任意です）</p>
            <LFWizCard>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>持ち物（任意）</label>
                <textarea value={jobNotes} onChange={e => setJobNotes(e.target.value)} placeholder="例：長靴、軍手、飲み物" className="field f-sans" rows={2} style={{ fontSize:13, resize:"vertical" }} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>注意事項（任意）</label>
                <textarea value={jobCautions} onChange={e => setJobCautions(e.target.value)} placeholder="例：天候により作業時間が変わることがあります" className="field f-sans" rows={2} style={{ fontSize:13, resize:"vertical" }} />
              </div>
              {/* 必要経験の選択式は撤回（2026-07-18）：はじめてOK・経験者優遇・リピート即決の3トグルに整理。jobExpは旧求人の表示用に温存 */}
              <div style={{ marginBottom:10 }}>
                <button type="button" onClick={()=>setBeginnerOk(v=>!v)} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"12px 14px", borderRadius:12, border:"2px solid", borderColor: beginnerOk ? "#00A86B" : "#EBEBEB", background: beginnerOk ? "#E6F7EF" : "#fff", cursor:"pointer" }}>
                  <span style={{ display:"block", fontSize:14, fontWeight:700, color: beginnerOk ? "#00A86B" : "#222" }}>🌱 はじめての人も歓迎{beginnerOk ? "　✓" : ""}</span>
                  <span style={{ display:"block", fontSize:11, color:"#717171", marginTop:2 }}>求人カードに「🌱はじめてOK」バッジが表示されます</span>
                </button>
                <button type="button" onClick={()=>setFlagInfoOpen("beginner")} className="f-sans" style={{ background:"none", border:"none", padding:"4px 2px 0", fontSize:12, color:"#00A86B", textDecoration:"underline", cursor:"pointer" }}>はじめてOKとは？</button>
              </div>
              <div style={{ marginBottom:10 }}>
                <button type="button" onClick={()=>setExperiencedPreferred(v=>!v)} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"12px 14px", borderRadius:12, border:"2px solid", borderColor: experiencedPreferred ? "#1A56C5" : "#EBEBEB", background: experiencedPreferred ? "#E8F0FE" : "#fff", cursor:"pointer" }}>
                  <span style={{ display:"block", fontSize:14, fontWeight:700, color: experiencedPreferred ? "#1A56C5" : "#222" }}>💪 経験者優遇{experiencedPreferred ? "　✓" : ""}</span>
                  <span style={{ display:"block", fontSize:11, color:"#717171", marginTop:2 }}>求人カードに「💪経験者優遇」バッジが表示されます</span>
                </button>
                <button type="button" onClick={()=>setFlagInfoOpen("expert")} className="f-sans" style={{ background:"none", border:"none", padding:"4px 2px 0", fontSize:12, color:"#1A56C5", textDecoration:"underline", cursor:"pointer" }}>経験者優遇とは？</button>
              </div>
              <div>
                <button type="button" onClick={()=>setInstantApproveRepeat(v=>!v)} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"12px 14px", borderRadius:12, border:"2px solid", borderColor: instantApproveRepeat ? "#D9A013" : "#EBEBEB", background: instantApproveRepeat ? "#FFF8E7" : "#fff", cursor:"pointer" }}>
                  <span style={{ display:"block", fontSize:14, fontWeight:700, color: instantApproveRepeat ? "#8A6D1D" : "#222" }}>🌟 また呼びたい即決{instantApproveRepeat ? "　✓" : ""}</span>
                  <span style={{ display:"block", fontSize:11, color:"#717171", marginTop:2 }}>あなたがお気に入り登録（また呼びたい）した方の応募だけ、自動で承認されます（採用ではありません）</span>
                </button>
                <button type="button" onClick={()=>setFlagInfoOpen("repeat")} className="f-sans" style={{ background:"none", border:"none", padding:"4px 2px 0", fontSize:12, color:"#8A6D1D", textDecoration:"underline", cursor:"pointer" }}>リピート即決とは？</button>
              </div>
            </LFWizCard>

            {/* 「〇〇とは？」説明ボックス（2026-07-18）：タップで展開・✕/背景で閉じる。フロー横スワイプに拾われないようタッチを遮断 */}
            {flagInfoOpen && (() => {
              const info = flagInfoOpen === "beginner"
                ? { icon:"🌱", title:"はじめてOKとは？", body:"農業がはじめての人も歓迎する求人であることを示すマークです。ONにすると、求人カードと詳細ページに「🌱はじめてOK」バッジが表示され、経験のない方も応募しやすくなります。承認するかどうかの判断は、これまで通りあなたが行います。" }
                : flagInfoOpen === "expert"
                ? { icon:"💪", title:"経験者優遇とは？", body:"農作業の経験がある方を優先したいことを示すマークです。ONにすると、求人カードと詳細ページに「💪経験者優遇」バッジが表示され、経験のある方が応募しやすくなります。経験の浅い方の応募を妨げるものではなく、承認の判断はこれまで通りあなたが行います。" }
                : { icon:"🌟", title:"リピート即決とは？", body:"一緒に働いたあと、あなたが「また呼びたい」と評価してお気に入り登録した方が、この求人に応募したときだけ、自動的に承認される仕組みです（承認は採用ではありません。採用は打ち合わせ・面接のあとに、あなたが「採用する」で決めます）。登録していない方の応募は、これまで通りあなたが判断します。効果はあなた自身の求人だけに働き、ほかの農家の求人には影響しません。" };
              return (
                <div onClick={()=>setFlagInfoOpen(null)}
                  onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()}
                  style={{ position:"fixed", inset:0, zIndex:8000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease", display:"flex", alignItems:"center", justifyContent:"center", padding:"24px 12px" }}>
                  <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"relative", width:"100%", maxWidth:480, background:"#fff", borderRadius:20, padding:"28px 24px 24px", boxShadow:"0 12px 48px rgba(0,0,0,0.25)" }}>
                    <button onClick={()=>setFlagInfoOpen(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                    <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:"0 0 12px" }}>{info.icon} {info.title}</p>
                    <p className="f-sans" style={{ fontSize:14, color:"#444", lineHeight:1.9, margin:0 }}>{info.body}</p>
                  </div>
                </div>
              );
            })()}
          </>)}

          {/* ── ページX: 移植待ち退避ブロック（step90=農家フロー非到達。グループ2/3項目をここに貯蔵し、移植先ができ次第移す。退避項目の次へ条件・バリデーションは付けない） ── */}
          {isFarmer && step === 90 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>移植待ち項目（退避所）</h2>
            <p className="f-sans" style={lfStyles.subtitle}>開発用の退避所です。農家フローには表示されません。移植先ができ次第、各ページへ移します。</p>
            <LFWizCard>
              {/* 8. 募集文テンプレート（グループ2予定） */}
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:8 }}>募集文テンプレート</label>
                <LFPillSelect options={["収穫補助","選果作業","定植作業","草刈り"]} value={jobTemplate} onSelect={setJobTemplate} />
              </div>
            </LFWizCard>
          </>)}

          {/* ── 農家 Step3: Airbnb風 掲載プレビュー確認 ── */}
          {/* ── 農家 Step3: Airbnb風 掲載プレビュー確認 ── */}
          {isFarmer && step === 11 && (() => {
            const rewardLabel = dailyWage > 0 ? `¥${dailyWage.toLocaleString()} / 日` : "未設定"; // 時給は廃止（2026-07-16）


            // jobs INSERT用ペイロードはトップレベルに移設（saveDraftToSupabaseからも参照するため）
            const handleSaveJob = async () => {
              if (jobSaving) return;
              const missing = getPublishMissingFields();
              // 募集者の項目【だけ】が欠けている時はここで止めない＝この直後のrecruitBox
              // （新規登録の内容が初期値で入った入力ボックス）がその場で開く方が親切（2026-08-07）
              const nonRecruiterMissing = missing.filter(m => !m.label.startsWith("募集者"));
              if (nonRecruiterMissing.length > 0) {
                setPublishModal(false); // チェックリストを閉じてから足りない欄のページへ送る
                goToMissingField(missing);
                return;
              }
              setJobSaving(true);
              try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) { saveDraft(); onLogin(); return; }
                // 募集者情報が揃っていなければ、その場でボックスを開いて入力してもらう（法令の明示事項）。
                // 未入力の欄は新規登録①の内容を初期値に入れる
                {
                  const { data: ep0 } = await supabase.from("employer_profiles")
                    .select("recruiter_name,recruiter_address,recruiter_contact").eq("auth_id", session.user.id).maybeSingle();
                  let nm = (ep0?.recruiter_name || "").trim();
                  let ad = (ep0?.recruiter_address || "").trim();
                  let ct = (ep0?.recruiter_contact || "").trim();
                  if (!nm || !ad || !ct) {
                    try {
                      const { data: ah } = await supabase.from("account_holders")
                        .select("full_name,company_name,postal_code,address,contact_phone,contact_email")
                        .eq("auth_id", session.user.id).maybeSingle();
                      if (ah) {
                        if (!nm) nm = (ah.company_name || "").trim() || (ah.full_name || "").trim();
                        if (!ad) ad = [(ah.postal_code || "").trim() ? "〒" + ah.postal_code.trim() : "", (ah.address || "").trim()].filter(Boolean).join(" ");
                        if (!ct) ct = (ah.contact_phone || "").trim() || (ah.contact_email || "").trim();
                      }
                    } catch {}
                    resumePublishRef.current = handleSaveJob;
                    setRecruitBox({ name: nm, address: ad, contact: ct, saving: false });
                    setJobSaving(false);
                    return;
                  }
                }
                // プロフィール審査中の掲載ブロックは廃止（2026-08-14 承認プロセスの削除。
                // 自由記述は保存＝即公開になったため「審査待ちの農家」という状態が存在しない）
                let _jn = draftJobNumber;
                if (!_jn) { try { const _d = JSON.parse(localStorage.getItem("landingFlowDraft_v1")||"{}"); _jn = _d.job_number ?? null; } catch {} }
                let error;
                // 掲載＝即公開（2026-08-14 承認プロセスの削除）。
                //  ・運営者本人（ADMIN_EMAIL＝jobs admin write と厳密に同一）は従来どおり status='open' で直接INSERT。
                //  ・一般農家は RLS が draft/pending しか許さないので、pending で保存→直後に publish_my_job RPC で open に。
                //    掲載の壁（最賃・時間外・募集主情報・第三者フラグ＝キルスイッチ）は全てDBトリガーで発火する。
                //    フラグが 'false' に戻された時は RPC が拒否し、求人は pending（公開間近）のまま残る＝従来の承認制に自動復帰。
                const canOpen = isAdmin(session.user);
                const payload = await buildJobPayload(session.user.id, canOpen ? "open" : "pending");
                if (_jn) {
                  const r = await supabase.from("jobs").update(payload).eq("job_number", _jn).eq("farmer_id", session.user.id);
                  error = r.error;
                } else {
                  const r = await supabase.from("jobs").insert(payload).select("job_number").single();
                  error = r.error;
                  if (!error && r.data) { _jn = r.data.job_number; setDraftJobNumber(r.data.job_number); }
                }
                if (error && String(error.message || "").includes("RECRUITER_INFO_REQUIRED")) {
                  // DB側の最終ゲート（機構による拒否）。画面は動かさず、その場で入力ボックスを開く
                  resumePublishRef.current = handleSaveJob;
                  setRecruitBox({ name: "", address: "", contact: "", saving: false });
                  return;
                }
                if (error) {
                  alert("掲載エラー: " + error.message);
                  return;
                }
                // 一般農家：保存（pending）→ 即公開（publish_my_job）。失敗時は pending のまま残る
                // ＝「公開間近」表示・運営が手動で開ける従来経路が救済として生きる
                let publishedNow = true;
                if (!canOpen && _jn) {
                  const pub = await supabase.rpc("publish_my_job", { p_job_number: _jn });
                  if (pub.error || !pub.data?.ok) {
                    alert("掲載エラー: " + (pub.error?.message || pub.data?.reason || "不明") +
                      "\n求人は保存されています。時間をおいて、もう一度「掲載する」をお試しください。");
                    return;
                  }
                  // 修正のお願い中の求人だけは運営の確認を経て公開（2026-08-14・pending:true）
                  // ＝祝祭は「公開の準備が整いしだい」側に分岐（onPublished(false)）
                  if (pub.data?.pending) publishedNow = false;
                }
                // 掲載前の確認を記録に残す（2026-07-30たきと指示・行動記録の憲法）。
                // 画面のstateだけだった同意を、押した文言と時刻ごと追記のみの台帳へ。
                // 記録に失敗しても掲載自体は止めない（掲載は成功済み）が、管理者には見えるようにする
                if (_jn) {
                  try {
                    const { error: ckErr } = await supabase.from("job_publish_checks").insert({
                      job_number: _jn,
                      farmer_id: session.user.id,
                      // 2026-08-07 UI変更：4つの個別チェック→内容の列挙＋「確認しました」1つに。
                      // 掲載ボタンは確認済みでないと押せないため、記録は従来と同じ形
                      // （提示した4項目・全てchecked:true）で追記する＝台帳の形は変えない
                      items: PUBLISH_CHECKS.map((text) => ({ text, checked: true })),
                      agreed_at: new Date().toISOString(),
                    });
                    if (ckErr && isAdmin(session.user)) alert("【管理者デバッグ】掲載前の確認の記録に失敗：" + ckErr.message);
                  } catch {}
                }
                try { localStorage.removeItem("landingFlowDraft_v1"); } catch {}
                setDraftJobNumber(null);
                setPublishModal(false);
                // 完了は「ページ」でなくアニメーション（2026-08-07たきと指示）。Appに掲載成功を伝え、
                // App側で祝祭アニメ＋60秒アイドル→さがす を出す。onPublished 未指定時のみ従来の完了ページに倒す
                // 掲載＝即公開の祝祭。修正のお願い中の再掲載（publishedNow=false）だけ
                // 「公開の準備が整いしだい」側に分岐（2026-08-14）
                if (typeof onPublished === "function") { onPublished(publishedNow); }
                else { setPublishedOpen(publishedNow); setStep(12); }
              } catch (e) {
                alert("【管理者デバッグ】catch: " + (e?.message || e));
              } finally {
                setJobSaving(false);
              }
            };

            // 一時保存は下部ナビの「保存」ボタン（トップレベルのhandleTopSaveを再利用）に移設（2026-07-13）

            return (<>
              {/* タイトル */}
              <h2 className="f-sans" style={{ fontSize:"clamp(20px,3vw,30px)", fontWeight:850, color:"#222", marginBottom:6, lineHeight:1.3 }}>
                掲載イメージを確認してください
              </h2>
              <p className="f-sans" style={{ fontSize:14, color:"#717171", marginBottom:20 }}>働き手には、以下のように表示されます。</p>

              {/* 公開イメージ・セクション①：写真ギャラリー（求人詳細ページと同じく写真が先頭） */}
              {(() => {
                /* 作物の絵文字・3色の背景は、写真が無いときの水増し表示に使っていたもの。
                   求人者のアイコン1枚に置き換えたため削除（2026-07-30） */
                return (
                  <div style={{ marginBottom:28, maxWidth:1000, margin:"0 auto 5px" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", maxWidth:870, margin:"0 auto 8px" }}>
                      <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:0 }}>写真</p>
                      <button onClick={() => { setReturnToConfirm(true); setStep(7); }} className="f-sans" style={{ background:"none", border:"none", fontSize:13, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>編集</button>
                    </div>
                    <div style={{ position:"relative", maxWidth:870, margin:"0 auto" }}>
                      {/* 白落ち対策（2026-07-16）：iOS Safariでtransformアニメ中の親内のスナップスクロール画像が
                          白く描画されない事象への対処。translateZ(0)で各スライドを独立レイヤーに昇格（☰固定バグと同じ処方）。
                          画像URLが読めない場合は📷プレースホルダーが出る（真っ白のまま原因不明、を防ぐ） */}
                      {/* overflowY:hidden（2026-07-16）：スクローラー自身が縦にバウンスせず、縦ドラッグは親（ページ）のスクロールへ渡る */}
                      <div ref={confScrollRef} onScroll={handleConfPhotoScroll} onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} style={{ display:"flex", overflowX:"auto", overflowY:"hidden", scrollSnapType:"x mandatory", borderRadius:12, transform:"translateZ(0)", touchAction:"pan-x pan-y", overscrollBehaviorX:"contain" }}>
                        {jobPhotos.length > 0
                          ? (confLooped ? [jobPhotos[jobPhotos.length - 1], ...jobPhotos, jobPhotos[0]] : jobPhotos).map((p, i) => {
                              // 軽いサムネを先に敷いてから原寸を重ねる（2026-08-03たきと指示「確認ページの写真の復元が遅い」）。
                              // 原寸は平均400KB・最大10枚so、リロード直後は白いままだった。サムネ(640px・約1/6)は
                              // 一覧やカードで既に読み込み済みのことが多く、ほぼ即座に絵が出る→原寸が届いたら上に重なる
                              // ＝画質は原寸のまま（詳細ページのカルーセルをthumbにしない方針を守る）
                              const th = photoThumb(p);
                              const hasTh = th && th !== p.url;
                              return (
                              <div key={i} style={{ position:"relative", flexShrink:0, width:"100%", height:392, borderRadius:12, background: hasTh ? `#F0F0F0 url(${th}) center/cover no-repeat` : "#F0F0F0", scrollSnapAlign:"start", transform:"translateZ(0)" }}>
                                {!hasTh && <span aria-hidden="true" style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:48 }}>📷</span>}
                                <img loading="lazy" src={p.url} alt={`写真${i+1}`} onError={(e)=>{ e.currentTarget.style.display = "none"; }} style={{ position:"relative", width:"100%", height:"100%", objectFit:"cover", borderRadius:12 }} />
                                {p.caption && (
                                  <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"28px 20px 16px", background:"linear-gradient(transparent, rgba(0,0,0,0.65))", color:"#fff", fontSize:16, fontWeight:600, borderRadius:"0 0 12px 12px", boxSizing:"border-box" }}>{p.caption}</div>
                                )}
                              </div>
                              );
                            })
                          : (
                              /* 写真が1枚も無いときは、絵文字を3枚並べず、求人者のアイコンを1枚だけ大きく出す
                                 （2026-07-30たきと指示・求人詳細と同じ見え方） */
                              <div style={{ flexShrink:0, width:"100%", scrollSnapAlign:"start" }}>
                                <JobPhotoFallback url={confEmployer?.avatar_url} name={confEmployer?.nickname || "？"} />
                              </div>
                            )}
                      </div>
                      <button onClick={() => { const el = confScrollRef.current; if (el) el.scrollBy({ left: -el.offsetWidth, behavior:"smooth" }); }} style={{ position:"absolute", top:"50%", left:12, transform:"translateY(-50%)", width:40, height:40, borderRadius:"50%", border:"none", background:"rgba(255,255,255,0.9)", boxShadow:"0 2px 8px rgba(0,0,0,0.15)", cursor:"pointer", fontSize:18, color:"#222", display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
                      <button onClick={() => { const el = confScrollRef.current; if (el) el.scrollBy({ left: el.offsetWidth, behavior:"smooth" }); }} style={{ position:"absolute", top:"50%", right:12, transform:"translateY(-50%)", width:40, height:40, borderRadius:"50%", border:"none", background:"rgba(255,255,255,0.9)", boxShadow:"0 2px 8px rgba(0,0,0,0.15)", cursor:"pointer", fontSize:18, color:"#222", display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
                    </div>
                    <div style={{ display:"flex", justifyContent:"center", gap:6, marginTop:8 }}>
                      {/* 写真が無いときは1枚しか無いのでドットも出さない（3つ出ていた） */}
                      {jobPhotos.map((_, i) => i).map(i => (
                        <span key={i} style={{ fontSize:10, color: i === confActiveSlide ? "#00A86B" : "#D0D0D0" }}>{i === confActiveSlide ? "●" : "○"}</span>
                      ))}
                    </div>
                    {/* 写真の並び替え（2026-07-19）：◀▶で隣と入れ替え＋長押しドラッグ（2026-08-03）。
                        先頭が求人カードのカバー。実装はモジュールレベルの LFPhotoReorderStrip */}
                    {jobPhotos.length > 1 && (
                      <div style={{ maxWidth:870, margin:"12px auto 0" }}>
                        <LFPhotoReorderStrip photos={jobPhotos} setPhotos={setJobPhotos} />
                      </div>
                    )}
                    {jobPhotos.length === 0 && <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", textAlign:"center", marginTop:8 }}>※ 写真は後から登録できます。現在はイメージです。</p>}
                  </div>
                );
              })()}

              {/* 仕事の内容 / 保険 / 質問 タブ（第10弾・2026-07-22）。中身は横スワイプでも切替（2026-07-27） */}
              <ContentQSwipeArea value={confTab} onChange={setConfTab} showInsurance={Array.isArray(confEmployer?.insurance_items) && confEmployer.insurance_items.length > 0}>
              <div style={{ maxWidth:870, margin:"0 auto" }}><ContentQTabs value={confTab} onChange={setConfTab} showInsurance={Array.isArray(confEmployer?.insurance_items) && confEmployer.insurance_items.length > 0} /></div>
              {confTab === "questions" ? (
                /* LandingFlow内に me は存在しない（未定義参照＝ReferenceErrorで画面真っ白の原因だった・2026-07-24修正）。
                   meはisAdmin判定（運営の非表示スイッチ）専用so未指定でよい。農家本人の回答UIはJobQuestions内のsession判定(isOwner)が担う */
                <div style={{ maxWidth:870, margin:"0 auto" }}><JobQuestions jobNumber={draftJobNumber} /></div>
              ) : (confTab === "insurance" && Array.isArray(confEmployer?.insurance_items) && confEmployer.insurance_items.length > 0) ? (
                <div style={{ maxWidth:870, margin:"0 auto" }}><InsurancePanel employer={confEmployer} /></div>
              ) : (<>
              {/* ヘッダー（求人詳細ページと同一構造：作物 作業｜地域）＋編集リンク */}
              <div style={{ marginBottom:20 }}>
                {/* 集合場所は番地まで明記（2026-08-03たきと指示）。確認ページ＝掲載前プレビューso
                    自分の入力値（farmerAddr）をそのまま出す。訪問者向けのモザイクは求人詳細側が担う */}
                <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:0, lineHeight:1.3 }}>{farmerCrop || "作物"} {farmerTask || "作業"}{farmerRegion ? `｜${farmerRegion}${farmerAddr ? farmerAddr : ""}` : ""}</h2>
                {/* はじめてOK・リピート即決＋待遇はタイトル下にも表示（2026-07-16・詳細ページと同じバッジ） */}
                {(beginnerOk || experiencedPreferred || instantApproveRepeat || perkBadges(jobPerks ? { ...(confEmployer || {}), ...jobPerks } : confEmployer).length > 0) && (
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
                    <JobFlagBadges beginner={beginnerOk} expert={experiencedPreferred} repeat={instantApproveRepeat} />
                    {perkBadges(jobPerks ? { ...(confEmployer || {}), ...jobPerks } : confEmployer).map(b => (
                      <span key={b} className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", background:"#F7F7F7", padding:"4px 12px", borderRadius:20 }}>{b}</span>
                    ))}
                  </div>
                )}
                <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", margin:0, marginTop:4, display:"flex", alignItems:"center", gap:10 }}>
                  編集：
                  <button onClick={() => { setReturnToConfirm(true); setStep(1); }} className="f-sans" style={{ background:"none", border:"none", fontSize:13, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>作物</button>
                  <button onClick={() => { setReturnToConfirm(true); setStep(2); }} className="f-sans" style={{ background:"none", border:"none", fontSize:13, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>作業</button>
                  <button onClick={() => { setReturnToConfirm(true); setStep(3); }} className="f-sans" style={{ background:"none", border:"none", fontSize:13, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>集合場所</button>
                </p>
              </div>

              {/* ═══ 掲載プレビュー本体（右パネル削除により1カラム・中央寄せ） ═══ */}
              <div style={{ maxWidth:870, margin:"0 auto" }}>

                {/* ── 左: 掲載プレビュー（求人詳細ページの左カラムと同一構造） ── */}
                <div>
                  {/* 主要情報カード（詳細ページと同じ・各行に編集リンク・未入力は「未設定」表示） */}
                  <div style={{ width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                    <div className="job-detail-info-grid">
                      {[
                        // 期間ものは「〜終了日」を下段に折り返す（2026-07-16・whiteSpace:pre-lineで改行）
                        { label:"日程",     value: jobDateLabel !== "日程を選択してください" ? jobDateLabel.replace("〜", "\n〜") : "", editStep:4 },
                        { label:"勤務時間", value: workTimeLabel, editStep:5 },
                        { label:"休憩時間", value: breakTime, editStep:5 },
                        { label:"採用人数", value: jobCount ? `${jobCount}人` : "", editStep:4 },
                        { label:"移動時間", value: stationLabel(nearestStation, commuteTime), editStep:3 },
                        // 報酬は金額だけ表示（2026-07-16）：支払いタイミング・支払方法を繋げると読みにくいため
                        { label:"報酬",     value: rewardLabel !== "未設定" ? rewardLabel : "", editStep:5 },
                      ].map(row => (
                        <div key={row.label} style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"center", textAlign:"center" }}>
                          <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", display:"flex", alignItems:"center", gap:6 }}>
                            {row.label}
                            <button onClick={() => { setReturnToConfirm(true); setStep(row.editStep); }} className="f-sans" style={{ background:"none", border:"none", fontSize:11, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>編集</button>
                          </span>
                          <span className="f-sans" style={{ fontSize:15, color: row.value ? "#222" : "#B0B0B0", fontWeight: row.value ? 600 : 400, lineHeight:1.6, whiteSpace:"pre-line" }}>{row.value || "未設定"}</span>
                        </div>
                      ))}
                    </div>
                    {/* draftはDB列が入る前なので「現在の固定ポリシー」を共通定数から表示（2026-08-02・ハードコード廃止） */}
                    <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"10px 0 0" }}>{payTermsLine(CURRENT_PAY_POLICY)}</p>
                  </div>

                  {/* 農家プロフィールカード（詳細ページと同一構造：アバター・自己紹介・待遇。
                      データは employer_profiles の本人行。未作成なら最小カードにフォールバック） */}
                  {(confEmployer && confEmployer.nickname) ? (() => {
                    const pk = jobPerks ? { ...confEmployer, ...jobPerks } : confEmployer; // この求人だけの待遇があれば上書き表示（2026-07-18）
                    const perkRows = [
                      { label:"送迎",     on: pk.has_transport,        value: pk.has_transport ? `あり${pk.transport_area ? "（" + pk.transport_area + "）" : ""}` : EMPTY_MARK },
                      { label:"駐車場",   on: pk.has_parking,          value: pk.has_parking ? `あり${pk.parking_capacity ? "（" + pk.parking_capacity + "台）" : ""}` : EMPTY_MARK },
                      { label:"通勤手当", on: pk.has_commute_allowance, value: pk.has_commute_allowance ? `あり${pk.commute_allowance_detail ? "（" + pk.commute_allowance_detail + "）" : ""}` : EMPTY_MARK },
                      { label:"賞与",     on: pk.has_bonus,            value: pk.has_bonus ? "あり" : EMPTY_MARK },
                      { label:"農家負担", on: pk.employer_pays_supplies, value: pk.employer_pays_supplies ? `あり${pk.supplies_cap ? "（" + pk.supplies_cap + "）" : ""}` : EMPTY_MARK },
                      { label:"アクセサリー", on: pk.accessory_ok,          value: pk.accessory_ok ? "OK" : EMPTY_MARK },
                      // 受動喫煙（2026-08-03たきと指示）：就業場所の受動喫煙対策は求人の明示事項。
                      // 確認ページは掲載前のプレビューso、プロフィールの現在値（confEmployer）を出す。
                      // 掲載すると掲載時トリガーがこの値をperksへ凍結し、以後は詳細ページにも同じ形で出る
                      { label:"受動喫煙", on: !!pk.smoking_policy,
                        value: pk.smoking_policy
                          ? (pk.smoking_policy === "喫煙場所あり"
                              ? `喫煙場所あり${pk.smoking_area ? "（" + pk.smoking_area + "）" : ""}`
                              : pk.smoking_policy)
                          : EMPTY_MARK },
                    ];
                    return (
                      <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                        {/* アイコン左・2倍(88px)・名前に「さん」・登録してからの月日。紹介文はここでは出さない（2026-07-16・詳細ページと同じ） */}
                        {/* アイコン・名前タップ→農園紹介をボックス展開（2026-07-16・詳細ページと同じ） */}
                        <div onClick={()=>setConfIntroOpen(true)} role="button" style={{ display:"flex", alignItems:"center", gap:14, textAlign:"left", cursor:"pointer" }}>
                          <Avatar url={confEmployer.avatar_url} name={confEmployer.nickname} size={70} />
                          <div style={{ minWidth:0 }}>
                            <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>{confEmployer.nickname}さん</p>
                            {confTrust?.member_since && (
                              <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>chitose-bank利用 {confTrust.member_since}から</p>
                            )}
                          </div>
                        </div>
                        <div style={{ borderTop:"1px solid #EBEBEB", margin:"14px 0 4px" }} />
                        {/* 待遇タップ→この求人だけの待遇を編集するボックスを展開（2026-07-18） */}
                        <div onClick={openPerksEdit} role="button" style={{ cursor:"pointer" }}>
                        <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:4, letterSpacing:".06em", textAlign:"center" }}>待遇{jobPerks ? "（この求人のみ変更中）" : ""}</p>
                        <div style={{ width:"fit-content", margin:"0 auto" }}>{/* 待遇ブロックはカード中央配置（2026-07-16・旧:境界線を中央に合わせるtranslateX(-78px)） */}
                          {perkRows.map((row, i) => (
                            <div key={row.label} style={{
                              display:"flex", alignItems:"center", gap:12, padding:"8px 0",
                              borderBottom: i < perkRows.length - 1 ? "1px solid #F7F7F7" : "none",
                            }}>
                              <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0", width:72, flexShrink:0 }}>{row.label}</span>
                              <span className="f-sans" style={{ fontSize:15, color: row.on ? "#222" : "#B0B0B0", fontWeight: row.on ? 600 : 400, lineHeight:1.6 }}>{row.value}</span>
                            </div>
                          ))}
                        </div>
                        <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#00A86B", textAlign:"center", margin:"8px 0 0" }}>タップして待遇を変更 →</p>
                        </div>
                      </div>
                    );
                  })() : (
                    <div onClick={()=>{ rememberFlowScroll(); setConfProfileOpen(true); }} role="button" style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5, cursor:"pointer" }}>{/* 未入力＝タップで農家プロの入力項目を展開（2026-07-16） */}
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center" }}>
                        <div style={{ width:44, height:44, borderRadius:"50%", background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, marginBottom:8 }}>🧑‍🌾</div>
                        <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0, marginBottom:2 }}>{farmerDisplayName || "農園名未設定"}</p>
                        <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:0 }}>{farmerExp ? `就農 ${farmerExp}` : "就農歴未設定"}</p>
                        <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#00A86B", margin:"8px 0 0" }}>タップして農園プロフィールを入力 →</p>
                      </div>
                    </div>
                  )}
                  {/* 待遇の編集ボックス（2026-07-18）：送迎から順。下部に「保存」（プロフィールにも反映）と「この求人のみ」 */}
                  {perksEditOpen && perkDraft && (
                    // cb-lock-scroll＝html/bodyを固定する汎用クラス（embedded表示ではページ自体が
                    // スクロールするため必要）。フロー本体のスクロール領域は flowScrollLock で塞ぐ。
                    // 背景に touch-action は付けない＝祖先に付けるとボックス内のスクロールまで止まる
                    <div onClick={()=>setPerksEditOpen(false)} onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:8000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
                      <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                          <button onClick={()=>setPerksEditOpen(false)} aria-label="閉じる" className="f-sans" style={{ width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:14, cursor:"pointer", flexShrink:0 }}>✕</button>
                          <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>🎁 待遇の変更</p>
                        </div>
                        <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"12px 16px 16px" }}>
                          {[
                            { k:"has_transport", l:"🚐 送迎", tk:"transport_area", tp:"送迎の範囲（例：吉野川市内）" },
                            { k:"has_parking", l:"🅿️ 駐車場", tk:"parking_capacity", tp:"台数（例：3）" },
                            { k:"has_commute_allowance", l:"🚃 通勤手当", tk:"commute_allowance_detail", tp:"内容（例：1日500円まで）" },
                            { k:"has_bonus", l:"🎁 賞与" },
                            { k:"employer_pays_supplies", l:"🧤 持ち物は農家負担", tk:"supplies_cap", tp:"上限（例：軍手・長靴まで）" },
                            { k:"accessory_ok", l:"💍 アクセサリーOK" },
                          ].map(row => (
                            <div key={row.k} style={{ borderBottom:"1px solid #F7F7F7", padding:"10px 0" }}>
                              <button type="button" onClick={()=>setPerkDraft(p=>({ ...p, [row.k]: !p[row.k] }))} className="f-sans" style={{ width:"100%", textAlign:"left", padding:"10px 12px", borderRadius:10, border:"2px solid", borderColor: perkDraft[row.k] ? "#00A86B" : "#EBEBEB", background: perkDraft[row.k] ? "#E6F7EF" : "#fff", cursor:"pointer", fontSize:14, fontWeight:700, color: perkDraft[row.k] ? "#00A86B" : "#222" }}>
                                {row.l}{perkDraft[row.k] ? "　✓" : ""}
                              </button>
                              {row.tk && perkDraft[row.k] && (
                                // 台数(parking_capacity)はinteger列so数字のみ入力させる（「3台」等を弾く・2026-07-19）
                                <input value={perkDraft[row.tk]} inputMode={row.tk === "parking_capacity" ? "numeric" : "text"}
                                  onChange={e=>{ const v = row.tk === "parking_capacity" ? e.target.value.replace(/[^0-9]/g, "") : e.target.value; setPerkDraft(p=>({ ...p, [row.tk]: v })); }}
                                  placeholder={row.tp} className="field f-sans" style={{ fontSize:13, marginTop:8, marginBottom:0 }} />
                              )}
                            </div>
                          ))}
                          {/* 受動喫煙（2026-08-07たきと指示）：UIはEmployerProfileEditと同じ2択＋場所。
                              求人ごとの上書きにはしない（2026-08-03裁定を維持）＝どちらのボタンでもプロフィールへ保存 */}
                          <div style={{ borderBottom:"1px solid #F7F7F7", padding:"10px 0" }}>
                            <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 8px" }}>🚭 受動喫煙の状況</p>
                            <LFPillSelect options={["禁煙（喫煙場所なし）","喫煙場所あり"]} value={perkDraft.smoking_policy} onSelect={(v)=>setPerkDraft(p=>({ ...p, smoking_policy: v }))} />
                            {perkDraft.smoking_policy === "喫煙場所あり" && (
                              <input value={perkDraft.smoking_area} onChange={e=>setPerkDraft(p=>({ ...p, smoking_area: e.target.value }))} placeholder="喫煙場所（例：屋外の休憩小屋の横）" maxLength={100} className="field f-sans" style={{ fontSize:13, marginTop:8, marginBottom:0 }} />
                            )}
                            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"8px 0 0", lineHeight:1.6 }}>受動喫煙は事業所（就業場所）の設定のため、「この求人のみ」を押した場合も農家プロフィールに保存されます。</p>
                          </div>
                          <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, marginTop:10 }}>
                            「保存」＝農家プロフィールの待遇も更新します。「この求人のみ」＝この求人だけに適用し、プロフィールは変わりません。
                          </p>
                        </div>
                        <div style={{ display:"flex", gap:8, padding:"10px 12px calc(10px + env(safe-area-inset-bottom, 0px))", borderTop:"1px solid #F0F0F0", flexShrink:0 }}>
                          <button onClick={savePerksToProfile} disabled={perkSaving} className="f-sans" style={{ flex:1, padding:"13px", fontSize:14, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:12, cursor:"pointer", opacity: perkSaving ? 0.6 : 1 }}>{perkSaving ? "保存中..." : "保存"}</button>
                          <button onClick={applyPerksToJobOnly} disabled={perkSaving} className="btn-primary f-sans" style={{ flex:1, padding:"13px", fontSize:14, fontWeight:700, borderRadius:12, opacity: perkSaving ? 0.6 : 1 }}>この求人のみ</button>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* 農家プロの入力項目ボックス（確認ページから・2026-07-16）。閉じるとカードに即反映 */}
                  {confProfileOpen && (
                    <div onClick={()=>setConfProfileOpen(false)} onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:8000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
                      <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                          <button onClick={()=>setConfProfileOpen(false)} aria-label="閉じる" className="f-sans" style={{ width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:14, cursor:"pointer", flexShrink:0 }}>✕</button>
                          <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>🧑‍🌾 農園プロフィール</p>
                        </div>
                        <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"4px 12px 16px" }}>
                          <EmployerProfileEdit />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 作業内容カード（詳細ページと同じ） */}
                  <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                      <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:0 }}>作業内容</p>
                      <button onClick={() => { setReturnToConfirm(true); setStep(8); }} className="f-sans" style={{ background:"none", border:"none", fontSize:13, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>編集</button>
                    </div>
                    {/* 未入力の定型文フォールバック（JT_MAP）は廃止（2026-08-09たきと報告「入力した覚えのない
                        文字が出力される」）。定型文は画面に出るだけで保存されず、公開後の求人には出ない＝
                        確認ページだけ嘘をついていた。憲法3条どおり実データ／未設定の二択にする */}
                    <p className="f-sans" style={{ fontSize:15, color: (jobDescription && jobDescription.trim()) ? "#222" : "#B0B0B0", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word", ...((jobDescription && jobDescription.trim()) ? {} : { textAlign:"center" }) }}>{(jobDescription && jobDescription.trim()) ? <LinkifiedText text={jobDescription} /> : "未設定"}</p>
                  </div>

                  {/* 経験・持ち物・備考カード：詳細ページと同じ3行縦積み設計（2026-07-16・タブ式から戻した）。
                      必要経験・持ち物はバッジ・備考は文章・すべて中央配置。未入力は「未設定」。
                      希望する働き手は削除済み（変数farmerWantedは保存・詳細表示で継続使用のため温存） */}
                  <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                    <div style={{ display:"flex", justifyContent:"flex-end" }}>
                      <button onClick={() => { setReturnToConfirm(true); setStep(10); }} className="f-sans" style={{ background:"none", border:"none", fontSize:13, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>編集</button>
                    </div>
                    {[
                      { label:"持ち物",     value: jobNotes, chips:true, pin:true },
                      { label:"備考・注意", value: jobCautions },
                      // 時間外労働（2026-08-03たきと指示・表示は持ち物／備考の下のまま）。
                      // 入力は勤務条件(step5)へ移したso、このブロックの「編集」(step10)ではなく
                      // 行に専用の編集リンクを添える＝ここから直せない項目にならないようにする
                      { label:"時間外労働", value: overtimeLine(overtimePolicy, overtimeDetail), editStep: 5 },
                    ].map(row => {
                      const has = row.value && String(row.value).trim();
                      return (
                        <div key={row.label} style={{ padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
                          <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", display:"block", marginBottom:2, textAlign:"center" }}>
                            {row.label}
                            {row.editStep && (
                              <button onClick={() => { setReturnToConfirm(true); setStep(row.editStep); }} className="f-sans" style={{ marginLeft:6, background:"none", border:"none", fontSize:11, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>編集</button>
                            )}
                          </span>
                          {row.chips && has
                            ? (
                              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:2, justifyContent:"center" }}>
                                {String(row.value).split(/[、,・\n／/]+/).map(s => s.trim()).filter(Boolean).map((c, i) => (
                                  <span key={i} className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", background:"#F7F7F7", borderRadius:20, padding:"6px 14px" }}>{row.pin ? "📌 " : ""}{c}</span>
                                ))}
                              </div>
                            )
                            : <span className="f-sans" style={{ fontSize:15, color: has ? "#222" : "#B0B0B0", lineHeight:1.6, overflowWrap:"break-word", wordBreak:"break-word", whiteSpace:"pre-wrap", display:"block", textAlign:"center" }}>{has ? row.value : "未設定"}</span>}
                        </div>
                      );
                    })}
                  </div>

                  {/* 危険区域カード（詳細ページと同一構造：場所→作業・縦積み・全幅写真） */}
                  {(jobDangerPlaces.some(p => p.label) || jobDangerTasks.some(t => t.label)) && (
                  <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
                    <div style={{ position:"relative", display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:20 }}>
                      <span style={{ fontSize:18 }}>⚠️</span>
                      <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>作業上の注意・危険箇所</h3>
                      <button onClick={() => { setReturnToConfirm(true); setStep(9); }} className="f-sans" style={{ position:"absolute", right:0, background:"none", border:"none", fontSize:13, color:"#00A86B", textDecoration:"underline", cursor:"pointer", padding:0 }}>編集</button>
                    </div>
                    {jobDangerPlaces.some(p => p.label) && (
                      <>
                        <div style={{ display:"flex", flexDirection:"column", gap:16, marginBottom:28 }}>
                          {jobDangerPlaces.filter(p => p.label).map((place, i) => (
                            <DangerItem key={i} icon={place.icon} label={place.label} desc={place.desc} photos={place.photos} />
                          ))}
                        </div>
                      </>
                    )}
                    {jobDangerTasks.some(t => t.label) && (
                      <>
                        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                          {jobDangerTasks.filter(t => t.label).map((task, i) => (
                            <DangerItem key={i} icon={task.icon} label={task.label} desc={task.desc} photos={task.photos} />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  )}
                </div>

                {/* 右パネル（報酬・期間・カレンダー・一時保存）は削除（2026-07-13）。
                    報酬・日程は左の主要情報カードに編集リンク付きで表示済み。
                    一時保存は下部ナビ「保存」・保存中オーバーレイはLandingFlowトップレベルへ移設 */}
              </div>
              {/* ═══ 地図（集合場所のおおよその範囲・円のみ。求人詳細ページのJobLocationMapと同一構造。
                   旧Googleマップ風ダミーは廃止(2026-07-14)。座標は住所からgeocodeTownで取得(保存時と同じ手順) ═══ */}
              <div style={{ maxWidth:870, margin:"0 auto 5px" }}>
                {/* 番地まで明記する画面so、Googleマップ導線にも番地を渡す（2026-08-03）。
                    ピン自体は従来どおり町域重心＝addressShownで注記の文言を実態に合わせる。
                    mapQueryは郵便番号とスペース区切りを廃止（2026-08-03）：人が手で入力する形
                    （都道府県+市区町村+町域+番地・区切りなし）と同じ文字列にする。
                    郵便番号を混ぜるとGoogleが郵便番号の区域中心に着地することがある */}
                <JobLocationMap lat={confGeo?.lat} lng={confGeo?.lng} radius={confGeo?.radius} label={farmerRegion}
                  mapQuery={[farmerPref, farmerCity, farmerTown, farmerAddr].map(s => (s || "").trim()).filter(Boolean).join("")}
                  addressShown={!!farmerAddr} />
              </div>

              {/* 開催期間カレンダー（地図の下・2026-07-16・詳細ページと同じ） */}
              {jobDateStart && (
                <div className="calendar-below-map" style={{ maxWidth:870, margin:"0 auto 5px" }}>
                  <CalendarView start={jobDateStart} end={jobDateEnd} readOnly={true} holidays={jobHolidays} />
                </div>
              )}
              </>)}
              </ContentQSwipeArea>

              {/* 農園紹介セクションはページから削除（2026-07-16）。内容は農家カードのアイコン・名前タップのボックスに集約 */}

              {/* ═══ 農園紹介モーダル（詳細ページと同構造。お題＋代表よりの全文） ═══ */}
              {confIntroOpen && confEmployer && (() => {
                const topics = farmIntroTopics(confEmployer);
                return (
                  <div onClick={() => setConfIntroOpen(false)} style={{
                    position:"fixed", inset:0, zIndex:10000,
                    background:"rgba(0,0,0,0.5)", animation:"fadeIn .2s ease", touchAction:"none",
                  }}>
                    <div onClick={e => e.stopPropagation()} className="cb-sheet-up" style={{
                      position:"absolute", left:0, right:0, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))",
                      maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, padding:20,
                      overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y",
                    }}>
                      {/* ✕・タイトルは削除（2026-08-14たきと指示・詳細ページの農園紹介と同一様式）＝
                          閉じるはボックス外タップ。名乗りは信頼カード内の氏名行が担う */}
                      {/* まず信頼カード（農園紹介の下のボックス）→次に農園紹介（2026-07-16・詳細ページと同じ） */}
                      {/* 質問形式の群れは代表よりの下へ移植（2026-08-14たきと指示・詳細ページと同一様式）。
                          カード内のQaChatはhideQaで出さない */}
                      {(farmHostQa(confEmployer).length > 0 || !!confEmployer.interaction_style || !!confTrust) && (
                        <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:16 }}>
                          <FarmerTrustCard profile={confEmployer} trust={confTrust} hideQa />
                        </div>
                      )}
                      {confEmployer.owner_comment && confEmployer.owner_comment.trim() && (
                        <div style={{ background:"#F7F7F7", borderRadius:16, padding:"16px", marginBottom:16 }}>
                          <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>代表より</p>
                          <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{confEmployer.owner_comment}</p>
                        </div>
                      )}
                      {/* 質問形式の群れ（問いかけQ&A＋紹介文のお題）＝代表よりの下（2026-08-14たきと指示） */}
                      {(() => {
                        const qaAll = [...farmHostQa(confEmployer), ...topics.map(t => ({ q: t.label, a: t.body }))];
                        return qaAll.length > 0 ? <QaChat items={qaAll} accent="#00A86B" /> : null;
                      })()}
                    </div>
                  </div>
                );
              })()}

              {/* ═══ 掲載モーダル（下部ナビ「掲載する」から展開。チェックリスト・同意・掲載・注意文を右パネルから移植） ═══ */}
              {publishModal && (
                <div onClick={() => setPublishModal(false)} onTouchStart={e=>e.stopPropagation()} onTouchMove={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:8000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
                  <div onClick={(e) => e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
                      <button onClick={() => setPublishModal(false)} aria-label="閉じる" className="f-sans" style={{ width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:14, cursor:"pointer", flexShrink:0 }}>✕</button>
                      <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>📋 掲載前の確認</p>
                    </div>
                    <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"12px 16px 16px" }}>
                      <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:8 }}>掲載前に、以下をご確認ください</p>
                      {/* 文言は lib/utils の PUBLISH_CHECKS（表示と記録で共用・2026-07-30）。
                          2026-08-07たきと指示：個別チェックをやめ本文の列挙にし、チェックは下の1つに集約 */}
                      {PUBLISH_CHECKS.map((text, i) => (
                        <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"7px 0" }}>
                          <span aria-hidden="true" style={{ color:"#00A86B", fontWeight:700, flexShrink:0, lineHeight:1.6 }}>・</span>
                          <span className="f-sans" style={{ fontSize:14, color:"#222", lineHeight:1.6 }}>{text}</span>
                        </div>
                      ))}
                      <p className="f-sans" style={{ fontSize:13, color:"#0E6A52", background:"#F1F8F4", padding:"8px 12px", borderRadius:8, textAlign:"center", margin:"10px 0 0" }}>「掲載する」を押すと、働き手に公開されます。</p>
                      </div>
                    {/* 下部の固定ボタン（待遇の変更ボックスと同じ規格）。まとめて1つの確認チェックはボタンの直上 */}
                    <div style={{ padding:"10px 12px calc(10px + env(safe-area-inset-bottom, 0px))", borderTop:"1px solid #F0F0F0", flexShrink:0 }}>
                      <label style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, padding:"2px 0 8px", cursor:"pointer" }}>
                        <input
                          type="checkbox"
                          checked={publishConfirmed}
                          onChange={() => setPublishConfirmed(v => !v)}
                          style={{ width:20, height:20, flexShrink:0, accentColor:"#00A86B", cursor:"pointer" }}
                        />
                        <span className="f-sans" style={{ fontSize:15, fontWeight:700, color: publishConfirmed ? "#00A86B" : "#222" }}>確認しました</span>
                      </label>
                      <button
                        onClick={handleSaveJob}
                        disabled={jobSaving || !publishConfirmed}
                        className="btn-primary"
                        style={{ width:"100%", padding:"13px", fontSize:14, fontWeight:700, borderRadius:12, ...(!publishConfirmed ? { background:"#EBEBEB", color:"#717171" } : {}) }}
                      >
                        {jobSaving ? "保存中..." : "同意して掲載する"}
                      </button>
                      {!publishConfirmed && (
                        <p style={{ fontSize:13, color:"#717171", textAlign:"center", margin:"8px 0 0" }}>「確認しました」にチェックすると掲載できます</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>);
          })()}

          {/* ── 農家 Step3: 完了 ── */}
          {/* ── 農家 Step3: 完了 ── */}
          {isFarmer && step === 12 && (<>
            <div style={{ minHeight:"70vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", maxWidth:400, margin:"0 auto", padding:"0 20px" }}>
              <div style={{ fontSize:56, marginBottom:16 }}>{publishedOpen ? "🎉" : "🌱"}</div>
              <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:12 }}>{publishedOpen ? "公開しました！" : "求人ができました！"}</h2>
              <p className="f-sans" style={{ fontSize:16, color:"#717171", lineHeight:1.8, marginBottom:28 }}>
                {publishedOpen ? (<>働き手に公開されました。<br/>「さがす」に並んでいます。</>)
                              : (<>公開の準備が整いしだい、働き手に届きます。<br/>公開されると「さがす」に並び、応募が届きます。</>)}
              </p>
              <div style={{ display:"grid", gap:10, width:"100%" }}>
                {/* 遷移先は農家プロフィール（App.jsxのonComplete＝/profile/employer）so、ラベルもそれに合わせる。
                    旧「あなたの求人を見る」は実際の行き先と食い違っていた（2026-07-26たきと指示） */}
                <button onClick={onComplete} className="btn-primary" style={{ width:"100%", padding:"15px", fontSize:14, borderRadius:12 }}>プロフィールに戻る</button>
                <button onClick={()=>{ try{localStorage.removeItem("landingFlowDraft_v1");}catch{} if(typeof onComplete==="function") onComplete(); setTimeout(()=>{ window.location.hash="/work/new"; }, 50); }} style={{ width:"100%", padding:"13px", fontSize:13, background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, color:"#222", cursor:"pointer", fontFamily:"inherit" }}>新しい求人を出す</button>
              </div>
            </div>
          </>)}

          {/* ── WORKER FLOW ── */}
{/* ── WORKER FLOW ── */}
          {isWorker && step === 1 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>農業経験を教えてください</h2>
            <p className="f-sans" style={lfStyles.subtitle}>経験は問いません。当てはまるものをお選びください</p>
            {["未経験","経験あり"].map(v => (
              <LFCardBtn key={v} selected={workerExp===v} onClick={() => selectAndNext(setWorkerExp, v)}>
                <div className="f-sans" style={lfStyles.cardTitle}>{v}</div>
              </LFCardBtn>
            ))}
          </>)}

          {isWorker && step === 2 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>何をしたいですか？</h2>
            <p className="f-sans" style={lfStyles.subtitle}>あとから変更できます</p>
            <LFCardBtn selected={workerPurpose==="open"} onClick={() => selectAndNext(setWorkerPurpose, "open")}>
              <div className="f-sans" style={lfStyles.cardTitle}>📅 働ける日を公開する</div>
              <div className="f-sans" style={lfStyles.cardDesc}>農家からオファーを受けたい</div>
            </LFCardBtn>
            <LFCardBtn selected={workerPurpose==="search"} onClick={() => selectAndNext(setWorkerPurpose, "search")}>
              <div className="f-sans" style={lfStyles.cardTitle}>🔍 募集中の仕事を探す</div>
              <div className="f-sans" style={lfStyles.cardDesc}>自分から応募したい</div>
            </LFCardBtn>
          </>)}

          {isWorker && step === 3 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>働き手プロフィール</h2>
            <p className="f-sans" style={lfStyles.subtitle}>農家に見せる情報を入力してください</p>
            <LFWizCard>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>表示名</label>
                <input value={workerDisplayName} onChange={e => setWorkerDisplayName(e.target.value)} placeholder="例：田中 T." className="field f-sans" style={{ fontSize:16 }} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>活動地域</label>
                <input value={workerRegion} onChange={e => setWorkerRegion(e.target.value)} placeholder="例：吉野川市" className="field f-sans" style={{ fontSize:16 }} />
                <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", marginTop:4, lineHeight:1.5 }}>※ 市町村まで。番地・字は公開されません</p>
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>移動手段</label>
                <LFPillSelect options={["車","バイク","自転車","公共交通"]} value={workerTransport} onSelect={setWorkerTransport} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>働ける曜日</label>
                <LFMultiPill options={["月","火","水","木","金","土","日"]} values={workerDays}
                  onToggle={d => setWorkerDays(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev,d])} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>働ける時間帯</label>
                <LFPillSelect options={["早朝（〜8時）","午前","午後","夕方以降","終日"]} value={workerTimeSlot} onSelect={setWorkerTimeSlot} />
              </div>
              <div style={{ marginBottom:14 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>やりたい作業</label>
                <LFPillSelect options={["収穫","定植","選果","草刈り","農薬散布","梱包","なんでも"]} value={workerWork} onSelect={setWorkerWork} />
              </div>
              <div>
                <label className="f-sans" style={lfStyles.inputLabel}>経験のある作物</label>
                <LFPillSelect options={["トマト","キュウリ","イチゴ","米","なんでも"]} value={workerCrop} onSelect={setWorkerCrop} />
              </div>
            </LFWizCard>
          </>)}

          {isWorker && step === 4 && (<>
            <h2 className="f-sans" style={lfStyles.stepTitle}>希望報酬を入力します</h2>
            <p className="f-sans" style={lfStyles.subtitle}>平均・中央値と比較できます（参考値）</p>
            <LFWizCard>
              <div style={{ marginBottom:16 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>希望時給 <span style={{ fontSize:13, color:"#B0B0B0", fontWeight:400 }}>（円）</span></label>
                <input type="number" value={workerHourly} onChange={e => setWorkerHourly(e.target.value)} placeholder="例：1200" className="field f-mono" style={{ fontSize:20, maxWidth:180 }} />
                <LFWageCompare type="時給" value={parseFloat(workerHourly)||0} avg={AVG_HOURLY} count={AVG_COUNT} />
              </div>
              <div style={{ marginBottom:16 }}>
                <label className="f-sans" style={lfStyles.inputLabel}>希望日給 <span style={{ fontSize:13, color:"#B0B0B0", fontWeight:400 }}>（円）</span></label>
                <input type="number" value={workerDaily} onChange={e => setWorkerDaily(e.target.value)} placeholder="例：9000" className="field f-mono" style={{ fontSize:20, maxWidth:180 }} />
                <LFWageCompare type="日給" value={parseFloat(workerDaily)||0} avg={AVG_DAILY} count={AVG_COUNT} />
              </div>
              <div>
                <label className="f-sans" style={lfStyles.inputLabel}>日給の場合の想定勤務時間 <span style={{ fontSize:13, color:"#B0B0B0", fontWeight:400 }}>（時間）</span></label>
                <input type="number" value={workerHours} onChange={e => setWorkerHours(e.target.value)} placeholder="例：8" className="field f-mono" style={{ fontSize:16, maxWidth:120 }} />
                {workerDaily && workerHours && parseFloat(workerHours) > 0 && (
                  <p className="f-sans" style={{ fontSize:13, color:"#717171", marginTop:4 }}>
                    時給換算：<span className="f-mono" style={{ fontWeight:700 }}>¥{Math.round(parseFloat(workerDaily)/parseFloat(workerHours)).toLocaleString()}/h</span>
                  </p>
                )}
              </div>
              <LFWageNote />
            </LFWizCard>
          </>)}

          {isWorker && step === 5 && (<>
            <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>プロフィール確認</h2>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:16 }}>農家に表示される情報です</p>
            <LFWizCard>
              <LFSummaryRow label="表示名"   value={workerDisplayName || "未入力"} />
              <LFSummaryRow label="経験"     value={workerExp} />
              <LFSummaryRow label="地域"     value={workerRegion || "未入力"} />
              <LFSummaryRow label="移動手段" value={workerTransport || "未設定"} />
              <LFSummaryRow label="曜日"     value={workerDays.length ? workerDays.join("・") : "未設定"} />
              <LFSummaryRow label="時間帯"   value={workerTimeSlot || "未設定"} />
              <LFSummaryRow label="作業"     value={workerWork || "未設定"} />
              <LFSummaryRow label="目的"     value={workerPurpose==="open" ? "働ける日を公開" : "募集を探す"} />
            </LFWizCard>
          </>)}

          {isWorker && step === 6 && workerPurpose === "open" && (<>
            <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>希望条件の確認</h2>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:16 }}>これはプレビューです。実際の公開はまだ行いません</p>
            <LFWizCard>
              <LFSummaryRow label="地域"     value={workerRegion || "未入力"} />
              <LFSummaryRow label="曜日"     value={workerDays.length ? workerDays.join("・") : "未設定"} />
              <LFSummaryRow label="時間帯"   value={workerTimeSlot || "未設定"} />
              <LFSummaryRow label="移動手段" value={workerTransport || "未設定"} />
              <LFSummaryRow label="希望時給" value={workerHourly ? `¥${parseFloat(workerHourly).toLocaleString()}/h` : "未設定"} />
              <LFSummaryRow label="希望日給" value={workerDaily ? `¥${parseFloat(workerDaily).toLocaleString()}/日` : "未設定"} />
            </LFWizCard>
          </>)}

          {isWorker && step === 6 && workerPurpose === "search" && (
            <JobSearchMapView />
          )}

          {isWorker && step === 7 && (<>
            <h2 className="f-sans" style={{ fontSize:22, fontWeight:700, color:"#222", marginBottom:8 }}>内容の確認</h2>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", marginBottom:16 }}>構想段階のため、実際の公開は行いません</p>
            <LFWizCard>
              <LFSummaryRow label="ロール"    value="働き手" />
              <LFSummaryRow label="表示名"    value={workerDisplayName || "未設定"} />
              <LFSummaryRow label="経験"      value={workerExp} />
              <LFSummaryRow label="地域"      value={workerRegion || "未設定"} />
              <LFSummaryRow label="移動手段"  value={workerTransport || "未設定"} />
              <LFSummaryRow label="曜日"      value={workerDays.length ? workerDays.join("・") : "未設定"} />
              <LFSummaryRow label="目的"      value={workerPurpose==="open" ? "働ける日を公開" : "募集を探す"} />
              <LFSummaryRow label="希望時給"  value={workerHourly ? `¥${parseFloat(workerHourly).toLocaleString()}/h` : "未設定"} />
            </LFWizCard>
          </>)}

          {/* ③（2026-08-07）：onWorkerDone があれば親thatアニメーションに置換するのでこのページは出さない */}
          {isWorker && step === 8 && typeof onWorkerDone !== "function" && (<>
            <div style={{ textAlign:"center", paddingTop:20 }}>
              <div style={{ fontSize:56, marginBottom:16 }}>✅</div>
              <h2 className="f-sans" style={{ fontSize:20, fontWeight:700, color:"#222", marginBottom:10 }}>ありがとうございます</h2>
              <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.8, marginBottom:24 }}>
                この機能は現在構想段階です。<br/>
                実装前に労働局・関係機関へ確認した上で、段階的に追加予定です。
              </p>
              <div style={{ display:"grid", gap:10 }}>
                <button onClick={onLogin} className="btn-primary" style={{ width:"100%", padding:"15px", fontSize:14, borderRadius:12 }}>実証に参加する →</button>
                <button onClick={onSkip} style={{ width:"100%", padding:"13px", fontSize:13, background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, color:"#222", cursor:"pointer", fontFamily:"inherit" }}>公開データを見る</button>
                <button onClick={onComplete} className="f-sans" style={{ width:"100%", padding:"10px", background:"none", border:"none", fontSize:12, color:"#B0B0B0", cursor:"pointer" }}>意見を送る（準備中）</button>
              </div>
            </div>
          </>)}

        </div>
      </div>

      {/* 保存中オーバーレイ（下部ナビ「保存」・保存して終了 共通。どのstepでも表示。旧:確認ページ右パネル内） */}
      {draftOverlay && (
        <div style={{ position:"fixed", inset:0, background:"rgba(255,255,255,0.92)", zIndex:9999, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
          <div style={{ width:44, height:44, border:"4px solid #E0E0E0", borderTopColor:"#00A86B", borderRadius:"50%", animation:"cbspin 0.8s linear infinite" }} />
          <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700 }}>保存しています…</p>
          <style>{`@keyframes cbspin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* その場保存の完了表示（2026-08-03）：下部ナビ「保存」は遷移しないので、
          保存できたことをこの一言で知らせる。1.8秒で自然に消える */}
      {savedToast && (
        <div className="f-sans" style={{ position:"fixed", left:"50%", transform:"translateX(-50%)", bottom:"calc(84px + env(safe-area-inset-bottom, 0px))", zIndex:9998, background:"rgba(34,34,34,0.92)", color:"#fff", fontSize:13, fontWeight:700, padding:"10px 18px", borderRadius:20, boxShadow:"0 4px 16px rgba(0,0,0,0.2)", pointerEvents:"none" }}>
          保存しました
        </div>
      )}

      {/* 開催期間カレンダー📅の浮遊ボタン＋モーダルは削除（2026-07-24・誰も展開しないため）。
          作業日程は主要情報カードの「日程」行の編集リンク（→step4）で選び直せる */}

      {/* 下部ナビのバーは削除（2026-07-16）：戻る／次へは浮遊固定ボックス（スクロール追従）に。
          embedded（プレビューシート内）はfixedが使えないため従来のバーを残す */}
      {/* 募集者情報の入力ボックス（2026-07-27たきと指示）：掲載申請が止まった時、ページを変えずにここで入力する */}
      {recruitBox && (
        <div onClick={()=>{ if (!recruitBox.saving) setRecruitBox(null); }} className="cb-box-overlay" style={{ zIndex:10500 }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up cb-notice-sheet">
            <p className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:0 }}>掲載には募集者情報が必要です</p>
            <div style={{ height:1, background:"#E5E5E5", margin:"12px 0" }} />
            <p className="f-sans" style={{ fontSize:13, color:"#555", lineHeight:1.7, margin:"0 0 14px" }}>
              労働者の募集広告には、募集者の氏名または名称・住所・連絡先の明示が必要です。
              入力すると、あなたの求人ページに「募集者情報」として表示されます。
            </p>
            {[["氏名・名称", "name", "例：山田 太郎 ／ 千歳農園"],
              ["住所・所在地", "address", "例：〒779-3401 徳島県吉野川市山川町〇〇1-2-3"],
              ["連絡先", "contact", "例：088-000-0000"]].map(([label, key, ph]) => (
              <div key={key} style={{ marginBottom:12 }}>
                <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:4 }}>{label}</label>
                <input value={recruitBox[key]} onChange={e=>setRecruitBox(v => ({ ...v, [key]: e.target.value }))} placeholder={ph}
                  className="field f-sans" style={{ width:"100%", fontSize:16, boxSizing:"border-box" }} />
              </div>
            ))}
            <button
              disabled={recruitBox.saving || !recruitBox.name.trim() || !recruitBox.address.trim() || !recruitBox.contact.trim()}
              onClick={async ()=>{
                setRecruitBox(v => ({ ...v, saving: true }));
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  if (!session) { setRecruitBox(v => ({ ...v, saving: false })); return; }
                  const { error } = await supabase.from("employer_profiles").upsert({
                    auth_id: session.user.id,
                    recruiter_name: recruitBox.name.trim(),
                    recruiter_address: recruitBox.address.trim(),
                    recruiter_contact: recruitBox.contact.trim(),
                    updated_at: new Date().toISOString(),
                  }, { onConflict: "auth_id" });
                  if (error) { alert("保存に失敗しました：" + error.message); setRecruitBox(v => ({ ...v, saving: false })); return; }
                  setRecruitBox(null);
                  const resume = resumePublishRef.current;
                  resumePublishRef.current = null;
                  if (typeof resume === "function") resume(); // そのまま掲載申請を続ける
                } catch { alert("保存に失敗しました"); setRecruitBox(v => ({ ...v, saving: false })); }
              }}
              className="btn-primary f-sans" style={{ width:"100%", padding:"14px", fontSize:15, fontWeight:700, borderRadius:12, marginTop:4 }}>
              {recruitBox.saving ? "保存中..." : "保存して掲載を続ける"}
            </button>
          </div>
        </div>
      )}

      {step > 0 && step < TOTAL && step !== 12 && !publishModal && (
        embedded ? (
        <div style={{
          background:"#fff", borderTop:"1px solid #EBEBEB", padding:"16px 8px",
          display:"flex", alignItems:"center", justifyContent: isAutoStep ? "flex-start" : "space-between",
          ...sheetNavHide,
        }}>
          {/* step1は戻る先が説明ページしかないため戻るボタンなし（2026-07-16）。spanはspace-betweenの左詰め維持用 */}
          {step === 1
            ? <span aria-hidden="true" />
            : <button onClick={returnToConfirm ? () => { setStep(11); setReturnToConfirm(false); } : goBack} className="f-sans" style={{ background:"none", border:"none", fontSize:15, color:"#222", cursor:"pointer", padding:"8px 0" }}>← 戻る</button>}
          {!isAutoStep && step !== 11 && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
              <button onClick={canGoNext ? (returnToConfirm ? () => { setStep(11); setReturnToConfirm(false); } : goNext) : undefined} className="btn-primary" style={{
                padding:"14px 28px", fontSize:15, fontWeight:700,
                cursor: canGoNext ? "pointer" : "not-allowed", opacity: canGoNext ? 1 : 0.5,
              }}>{returnToConfirm ? "確認に戻る →" : "次へ →"}</button>
              {!returnToConfirm && step >= 7 && step <= 10 && (
                <button onClick={() => setStep(11)} className="f-sans" style={{ background:"none", border:"none", fontSize:12, color:"#717171", textDecoration:"underline", cursor:"pointer", padding:0 }}>残りをスキップして確認へ →</button>
              )}
            </div>
          )}
          {isFarmer && step === 11 && (
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <button onClick={() => handleTopSave({ exit: true })} disabled={draftSaving} className="f-sans" style={{ padding:"14px 20px", fontSize:15, fontWeight:700, background:"#fff", border:"1px solid #DDD", borderRadius:12, color:"#222", cursor:"pointer" }}>{draftSaving ? "保存中..." : "保存"}</button>
              <button onClick={openPublish} className="btn-primary" style={{ padding:"14px 28px", fontSize:15, fontWeight:700 }}>掲載する</button>
            </div>
          )}
        </div>
        ) : (<>
          {/* ← 戻る：左下の浮遊ボックス（step1は非表示） */}
          {step !== 1 && (
            <button onClick={returnToConfirm ? () => { setStep(11); setReturnToConfirm(false); } : goBack} className="f-sans" style={{
              position:"fixed", left:12, bottom:"calc(16px + env(safe-area-inset-bottom, 0px))", zIndex:60,
              display:"flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20,
              fontSize:14, fontWeight:600, color:"#222", cursor:"pointer", padding:"12px 18px", boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
              ...sheetNavHide,
            }}>← 戻る</button>
          )}
          {/* 次へ（＋スキップ）：右下の浮遊ボックス */}
          {!isAutoStep && step !== 11 && (
            <div style={{ position:"fixed", right:12, bottom:"calc(16px + env(safe-area-inset-bottom, 0px))", zIndex:60, display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8 }}>
              {!returnToConfirm && step >= 7 && step <= 10 && (
                <button onClick={() => setStep(11)} className="f-sans" style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:12, color:"#717171", textDecoration:"underline", cursor:"pointer", padding:"7px 12px", boxShadow:"0 2px 8px rgba(0,0,0,0.12)" }}>残りをスキップして確認へ →</button>
              )}
              <button onClick={canGoNext ? (returnToConfirm ? () => { setStep(11); setReturnToConfirm(false); } : goNext) : undefined} className="btn-primary" style={{
                padding:"14px 28px", fontSize:15, fontWeight:700, borderRadius:20, boxShadow:"0 2px 8px rgba(0,0,0,0.18)",
                cursor: canGoNext ? "pointer" : "not-allowed", opacity: canGoNext ? 1 : 0.5,
              }}>{returnToConfirm ? "確認に戻る →" : "次へ →"}</button>
            </div>
          )}
          {/* 確認ページ(step11)：右下に「保存」＋「掲載する」の浮遊ペア */}
          {isFarmer && step === 11 && (
            <div style={{ position:"fixed", right:12, bottom:"calc(16px + env(safe-area-inset-bottom, 0px))", zIndex:60, display:"flex", alignItems:"center", gap:10, ...sheetNavHide }}>
              <button onClick={() => handleTopSave({ exit: true })} disabled={draftSaving} className="f-sans" style={{ padding:"14px 20px", fontSize:15, fontWeight:700, background:"#fff", border:"1px solid #DDD", borderRadius:20, color:"#222", cursor:"pointer", boxShadow:"0 2px 8px rgba(0,0,0,0.12)" }}>{draftSaving ? "保存中..." : "保存"}</button>
              <button onClick={openPublish} className="btn-primary" style={{ padding:"14px 28px", fontSize:15, fontWeight:700, borderRadius:20, boxShadow:"0 2px 8px rgba(0,0,0,0.18)" }}>掲載する</button>
            </div>
          )}
        </>)
      )}
    </div>
  );
}
