// 審査プレビュー兼オーナープレビュー（分割・大物①・2026-07-24）：働き手視点の求人詳細を全画面表示。
// 管理タブの審査（掲載/差し戻し）・農家自身の下書き/公開中プレビュー（閲覧のみ）の二役。
import { NavIcon, NavIconInline } from "./NavIcons";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import { mapJobPublicRow, payLabel, disp, stationLabel, fmtJstShort, payTermsLine, overtimeLine } from "../lib/utils";
import { Carousel, JobFlagBadges, DangerItem, Dots, LinkifiedText, MaskedAddress } from "./ui";
import { getCache, setCache } from "../lib/viewCache";
import { CalendarView } from "./CalendarView";
import { JobLocationMap } from "./JobLocationMap";
import { BelongingChips } from "./BelongingTags";
import { JobInsuranceSection } from "./InsurancePanel";
// 求人審査プレビューの「指摘」で選べる問題の種類（2026-07-19・タップ式修正依頼）
const JOB_REVISION_ISSUE_TYPES = ["最低賃金違反","虚偽・誇大の疑い","差別的な条件","連絡先の直書き・外部誘導","危険情報の欠落","個人情報・肖像権","表現が不明瞭","写真が不適切","その他"];

// ── AdminJobPreview（審査前プレビュー：働き手視点の求人詳細を管理者専用RPCで取得し全画面表示） ──
// 求人詳細の描画（写真ギャラリー・情報グリッド・disp()の「ー」・危険箇所・地図・カレンダー）を
// JobSearchMapViewの選択済み求人詳細と同じ見た目で再構成した軽量コンポーネント。
// JobSearchMapViewの詳細ブロックは応募状態(myApplication)・雇い手プロフィール取得・レビュー・
// 関連求人リストと密結合で、管理者プレビュー（未応募・審査中）には持ち込めない部分が多いため、
// mapJobPublicRow()で同じ形に整形したオブジェクトを、表示専用のこのコンポーネントに渡す方式にした。
export function AdminJobPreview({ jobNumber, onClose, onPublish, publishing, onRequestRevision, ownerView }) {
  // 前回開いた同じ求人（viewCache）は即描画→裏で最新に差し替え（SWR・2026-08-07たきと指示「一瞬でだせ」）。
  // ★キャッシュには生の行（JSON安全）だけを入れ、読む側で mapJobPublicRow する
  //   （Dateを含む整形後を入れると復元で文字列化して壊れる＝2026-08-03 getFullYear事故の教訓）
  const [job, setJob] = useState(() => {
    if (ownerView) return null;
    const raw = getCache("admin:previewRow:" + jobNumber);
    return raw ? mapJobPublicRow(raw) : null;
  });
  const [loading, setLoading] = useState(() => ownerView || !getCache("admin:previewRow:" + jobNumber));
  // 掲載前の確認の記録（2026-07-30）：undefined=読み込み中／null=記録なし／オブジェクト=最新の1件
  const [pubChecks, setPubChecks] = useState(undefined);
  const [pubOpen, setPubOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setPubChecks(undefined); setPubOpen(false);
    (async () => {
      try {
        // RLS：本人は自分の記録／運営は全件。権限が無ければ0件で返る（＝記録なし表示）
        const { data } = await supabase.from("job_publish_checks")
          .select("items,agreed_at").eq("job_number", jobNumber)
          .order("agreed_at", { ascending: false }).limit(1);
        if (!cancelled) setPubChecks((data && data[0]) || null);
      } catch { if (!cancelled) setPubChecks(null); }
    })();
    return () => { cancelled = true; };
  }, [jobNumber]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [dangerLightbox, setDangerLightbox] = useState(null);
  // タップ式修正依頼（2026-07-19）：審査中、プレビューの各項目の「指摘」を押して、何がどう問題かを積み上げる
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
  // 修正依頼モード（2026-08-07たきと指示「指摘は非表示。修正依頼をタップした時に表示」）：
  // 指摘チップは普段は出さない＝プレビューthaが働き手に見える姿のまま。下部バーの「修正を依頼」で
  // モードに入るとチップthaが現れる。0件のままもう一度押すとモード解除、1件以上で押すと送信
  const [revMode, setRevMode] = useState(false);
  // 指摘チップ（審査＋修正依頼モード時のみ表示）：各項目の右上に置く。指摘済みは色反転
  const revChip = (label) => (ownerView || !revMode) ? null : (
    <button onClick={(e)=>{ e.stopPropagation(); openFindingEditor(label); }} className="f-sans"
      style={{ position:"absolute", top:8, right:8, zIndex:4, background: findingFor(label) ? "#EA580C" : "rgba(255,255,255,0.95)", color: findingFor(label) ? "#fff" : "#EA580C", border:"1px solid #EA580C", borderRadius:16, padding:"4px 10px", fontSize:11, fontWeight:700, cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.15)" }}>
      {findingFor(label) ? "指摘済み" : "指摘"}
    </button>
  );
  const revOutline = (label) => (!ownerView && findingFor(label)) ? { outline:"2px solid #EA580C", outlineOffset:2 } : {};

  useEffect(() => {
    let cancelled = false;
    // キャッシュ表示中はスピナー・白紙に戻さない（裏で最新へ差し替えるだけ）
    if (ownerView || !getCache("admin:previewRow:" + jobNumber)) { setLoading(true); setJob(null); }
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
      // 失敗時は手元の表示を保つ（エラーの空で上書きしない＝2026-08-07規則）
      if (!error && row) { setJob(mapJobPublicRow(row)); setCache("admin:previewRow:" + jobNumber, row); }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [jobNumber, ownerView]);

  const handlePhotoScroll = e => {
    const el = e.target;
    setActiveSlide(Math.round(el.scrollLeft / el.clientWidth));
  };

  // 右スワイプで公開（2026-08-07たきと指示「公開の役割は右スワイプ。指に連動。公開するボタン削除」）。
  // しきい値（画面幅35%・最大140px）を超えて離すと公開、未満なら弾んで戻る。
  // スライドで下から公開の緑面がが現れる（進み具合＝視覚の答え合わせ）。
  // カルーセル内で始まったタッチは奪わない。修正依頼モード中・公開処理中・読み込み中は発動しない。
  // ★2026-08-07修理（「機能していない」）：ReactのonTouchMoveはpassive＝preventDefault不可で、
  //   iOSでは縦スクロール容器がジェスチャを奪い横の追従が効かなかった。今日ページ・タブスワイプと
  //   同じ実証済みの作法（ネイティブリスナー{passive:false}・方向ロック8px・transform直書き）に統一
  const swipeRef = useRef(null);   // {x, y, dx, lock, w}
  const swipeRootRef = useRef(null); // リスナーを張る外枠（非スクロール）。★スクロール容器に張ると
                                     // iOSの加速スクロールがイベントを飲むことがあるため外枠で受ける（2026-08-07再修理）
  const dragBoxRef = useRef(null); // スライドさせるスクロール容器（transformの対象）
  const pubHintRef = useRef(null); // 下に敷いた公開の緑面（opacityを直書き）
  // リスナーはマウント時に1度だけ張るので、発動条件は ref 経由で最新を読む
  const swipeGateRef = useRef({});
  swipeGateRef.current = { revMode, publishing, hasJob: !!job, editing: !!editTarget, onPublish };
  useEffect(() => {
    if (ownerView) return;
    const root = swipeRootRef.current, el = dragBoxRef.current;
    if (!root || !el) return;
    const onStart = (ev) => {
      const g = swipeGateRef.current;
      if (g.revMode || g.publishing || !g.hasJob || g.editing) { swipeRef.current = null; return; }
      if (ev.target.closest && ev.target.closest(".carousel-scroll")) { swipeRef.current = null; return; }
      const t = ev.touches[0]; if (!t) return;
      swipeRef.current = { x: t.clientX, y: t.clientY, dx: 0, lock: null, w: window.innerWidth || 1 };
    };
    const onMove = (ev) => {
      const s2 = swipeRef.current; if (!s2) return;
      const t = ev.touches[0]; if (!t) return;
      const dx = t.clientX - s2.x, dy = t.clientY - s2.y;
      if (!s2.lock) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // 8px動くまで判定保留
        s2.lock = Math.abs(dx) > Math.abs(dy) ? "h" : "v"; // 1ジェスチャ1回だけ軸を確定
      }
      if (s2.lock !== "h") return; // 縦確定＝ブラウザのスクロールに完全に譲る
      ev.preventDefault();
      s2.dx = Math.max(0, dx); // 右方向のみ（左は追従しない）
      el.style.transition = "none";
      el.style.transform = `translateX(${s2.dx}px)`;
      if (pubHintRef.current) pubHintRef.current.style.opacity = String(Math.min(1, s2.dx / 120));
    };
    const onEnd = () => {
      const s2 = swipeRef.current; swipeRef.current = null;
      if (!s2 || s2.lock !== "h") return;
      const g = swipeGateRef.current;
      const commit = s2.dx > Math.min(140, s2.w * 0.35);
      el.style.transition = "transform .25s ease";
      if (commit && g.onPublish && g.hasJob && !g.publishing) {
        el.style.transform = `translateX(${s2.w}px)`;
        g.onPublish(); // 成功時は親がプレビューを閉じる（既存挙動）
        // 失敗（alert後も画面がが残る）に備えて少し後に戻す
        setTimeout(() => {
          if (dragBoxRef.current) { dragBoxRef.current.style.transform = "translateX(0)"; }
          if (pubHintRef.current) pubHintRef.current.style.opacity = "0";
        }, 1500);
      } else {
        el.style.transform = "translateX(0)";
        if (pubHintRef.current) pubHintRef.current.style.opacity = "0";
      }
    };
    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd, { passive: true });
    root.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onEnd);
    };
  }, [ownerView]);

  // 本人シートを畳む（2026-08-08たきと指示「畳む条件はステータスページのアイコンタップボックスの規格と同じ」）。
  // 規格＝DragSheet／SavedJobsViewのboxJob：中身がが最上部（scrollTop<=0）のときだけ下向きドラッグが
  // シートを掴み、指に連動（transform直書き＝毎フレーム再レンダーしない）。引き下げたシートの上端がが
  // 画面の縦中央より下で指を離すと閉じる／上なら定位置へ戻す。閉じる道は背景タップとこの2つだけ（✕は置かない）
  const sheetRef = useRef(null);
  const ownerScrollRef = useRef(null);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => {
    if (!ownerView) return;
    const el = sheetRef.current; if (!el) return;
    el.style.transform = ""; el.style.transition = "";
    el.style.willChange = "transform";
    let sy = 0, baseY = 0, baseTop = 0, lastY = 0, tracking = false, grabbed = false, raf = 0;
    const paint = () => { raf = 0; el.style.transform = `translateY(${lastY}px)`; };
    const onStart = (e) => { if (e.touches.length !== 1) { tracking = false; return; } sy = e.touches[0].clientY; grabbed = false; tracking = true; };
    const onMove = (e) => {
      if (!tracking) return;
      const cy = e.touches[0].clientY, dy = cy - sy;
      if (!grabbed) {
        if (Math.abs(dy) < 8) return;              // 8px動くまで判定保留
        const sc = ownerScrollRef.current;
        if (!(dy > 0 && (!sc || sc.scrollTop <= 0))) { tracking = false; return; } // 上向き・スクロール余地あり＝通常スクロールに譲る
        grabbed = true; baseY = cy; baseTop = el.getBoundingClientRect().top;      // 掴んだ瞬間に基点を置き直す（跳びゼロ）
        el.style.transition = "none";
      }
      e.preventDefault();
      lastY = Math.max(0, cy - baseY);
      if (!raf) raf = requestAnimationFrame(paint);                                 // 1フレーム1回だけ書く
    };
    const onEnd = () => {
      if (!tracking || !grabbed) { tracking = false; return; }
      tracking = false; grabbed = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      const top = baseTop + lastY;
      el.style.transition = "transform .25s ease";
      if (top > window.innerHeight / 2) { el.style.transform = `translateY(${window.innerHeight}px)`; setTimeout(() => onCloseRef.current && onCloseRef.current(), 180); }
      else { el.style.transform = "translateY(0)"; }
      lastY = 0;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ownerView, jobNumber]);

  // document.bodyへポータル（2026-07-19）：呼び出し元の祖先（AdminTabの.appear等）がtransformを
  // 保持していると、その要素がposition:fixedの基準になり全画面に広がらない（審査プレビューが途中で切れる不具合）。
  // bodyへ出せばfixedの基準が確実にビューポートになる
  // cb-lock-scroll＝展開中は背後のページを固定し、下部バー・浮遊☰も隠す（2026-07-26たきと指示）
  return createPortal(
    <div onClick={ownerView ? onClose : undefined} className="cb-lock-scroll" style={ownerView
      ? { position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }
      : { position:"fixed", inset:0, zIndex:9000, background:"#fff" }}>
    {/* 下部バーを隠すので画面下端まで伸ばす（角丸は上だけ・セーフエリアは内側の下パディングで確保）。
        審査（!ownerView）も同じ flex column 構造＝上:説明バー／中:スクロール／下:操作ボタン固定バー
        （2026-08-05たきと指示「閉じる・修正を依頼・公開は下部に。上はタップしずらい」） */}
    <div ref={ownerView ? sheetRef : swipeRootRef} onClick={ownerView ? (e)=>e.stopPropagation() : undefined} className={ownerView ? "cb-sheet-up" : undefined} style={ownerView
      ? { position:"absolute", left:0, right:0, bottom:0, top:"6vh", maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:"20px 20px 0 0", display:"flex", flexDirection:"column", overflow:"hidden" }
      : { height:"100%", display:"flex", flexDirection:"column", position:"relative" }}>
      {/* グラバー（ステータスページの展開ボックスと同じ規格・2026-08-08たきと指示）。
          ✕は置かない＝閉じる道は「背景タップ」と「下スワイプで畳む」の2つ（DragSheetと同じ作法） */}
      {ownerView && (
        <div aria-hidden="true" style={{ flexShrink:0, display:"flex", justifyContent:"center", padding:"10px 0 2px" }}>
          <span style={{ width:40, height:4, borderRadius:2, background:"#E0E0E0" }} />
        </div>
      )}
      {/* 公開の緑面（審査のみ）：右スワイプでスクロール面thaが右へずれると下から現れる */}
      {!ownerView && (
        <div ref={pubHintRef} aria-hidden="true" style={{ position:"absolute", inset:0, background:"#00A86B", opacity:0,
          display:"flex", alignItems:"center", justifyContent:"flex-start", paddingLeft:28, pointerEvents:"none" }}>
          <span className="f-sans" style={{ color:"#fff", fontSize:22, fontWeight:800 }}>公開する →</span>
        </div>
      )}
      <div ref={ownerView ? ownerScrollRef : dragBoxRef} style={ownerView
        ? { flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", paddingBottom:"env(safe-area-inset-bottom, 0px)" }
        : { flex:1, overflowY:"auto", overscrollBehavior:"contain", paddingTop:"env(safe-area-inset-top, 0px)",
            background:"#fff", position:"relative", touchAction:"pan-y" }}>
      <div style={{ maxWidth:720, margin:"0 auto", padding:"24px 20px 100px" }}>
        {loading && (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"60px 0" }}>読み込み中<Dots /></p>
        )}
        {!loading && !job && (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"60px 0" }}>求人が見つかりません（権限がないか、削除された可能性があります）</p>
        )}
        {job && (<>
          {/* 掲載前の確認の記録（2026-07-30たきと指示）：農家が掲載時にチェックした自己申告。
              運営（審査）も本人も同じものを見る。RLSで、本人＝自分の記録／運営＝全件が返る。
              記録が無い＝この記録を始める前に出された求人（過去分は遡って作らない） */}
          <div style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"12px 14px", marginBottom:16, background:"#FAFAFA" }}>
            {pubChecks === undefined ? (
              <p className="f-sans" style={{ fontSize:12, color:"#999", margin:0 }}>掲載前の確認：読み込み中<Dots /></p>
            ) : pubChecks === null ? (
              <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", margin:0 }}>掲載前の確認：記録なし（記録の運用開始前に出された求人です）</p>
            ) : (() => {
              const items = Array.isArray(pubChecks.items) ? pubChecks.items : [];
              const okN = items.filter(x => x && x.checked).length;
              const all = okN === items.length && items.length > 0;
              return (
                <>
                  <button onClick={()=>setPubOpen(v=>!v)} className="f-sans" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"left" }}>
                    <span style={{ fontSize:12, fontWeight:700, color: all ? "#00A86B" : "#C77700" }}>
                      掲載前の確認：{okN}/{items.length} {all ? <NavIconInline name="tick" size={13} style={{ verticalAlign:"-2px", marginRight:0 }} /> : <NavIconInline name="alert" size={13} style={{ verticalAlign:"-2px", marginRight:0 }} />}
                      <span style={{ color:"#B0B0B0", fontWeight:400 }}>　{fmtJstShort(pubChecks.agreed_at)}</span>
                    </span>
                    <span style={{ fontSize:11, color:"#B0B0B0" }}>{pubOpen ? "閉じる ▲" : "内容を見る ▼"}</span>
                  </button>
                  {pubOpen && (
                    <div style={{ display:"grid", gap:6, marginTop:10 }}>
                      {items.map((x, i) => (
                        <p key={i} className="f-sans" style={{ fontSize:12, color: x.checked ? "#222" : "#C77700", margin:0, lineHeight:1.6 }}>
                          {x.checked ? <NavIconInline name="tick" size={12} style={{ verticalAlign:"-1.5px" }} /> : <NavIconInline name="close" size={12} style={{ verticalAlign:"-1.5px" }} />}{x.text}
                        </p>
                      ))}
                      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"4px 0 0", lineHeight:1.6 }}>この記録は変更・削除できません（追記のみの台帳）。</p>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
          {/* 写真ギャラリー */}
          {(() => {
            const photos = job.photos.length > 0 ? job.photos : [null, null, null];
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
                          ? <img loading="lazy" src={src} alt={cap || ""} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                          : <NavIcon name="image" size={72} style={{ color:"#C8C8C8" }} />}
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
            {/* 集合場所は番地まで明記（2026-08-03たきと指示）。この画面は管理者の審査・農家本人の
                プレビューので常にログイン済み＝unlocked。訪問者向けのモザイクは求人詳細側が担う */}
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
            {/* 掲載時に確定保存された支払条件を表示（2026-08-02・ハードコード廃止） */}
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"10px 0 0" }}>{payTermsLine(job)}</p>
          </div>

          {/* 作業説明 */}
          {job.jobBody && job.jobBody.trim() && (
          <div style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5, ...revOutline("作業内容") }}>
            {revChip("作業内容")}
            <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>作業内容</p>
            <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}><LinkifiedText text={job.jobBody} /></p>
          </div>
          )}

          {/* 経験・持ち物・備考（配列駆動・未入力は「ー」）。希望する働き手は削除・必要経験と持ち物はバッジ表示（2026-07-16） */}
          <div style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5, ...revOutline("持ち物・備考") }}>
            {revChip("持ち物・備考")}
            {[
              { label:"持ち物",     value: disp(job.items), chips:true },
              { label:"備考・注意", value: disp(job.cautions) },
              // 時間外労働（2026-08-03たきと指示・詳細/確認ページと同じ位置・同じ体裁）
              { label:"時間外労働", value: disp(overtimeLine(job.overtimePolicy, job.overtimeDetail)) },
              // 労働条件の明示・掲載時凍結の3項目（2026-08-21・詳細ページと同じ体裁）
              { label:"変更の範囲", value: disp((job.placeChangeScope || job.taskChangeScope) ? `場所：${job.placeChangeScope || "変更なし"}／作業：${job.taskChangeScope || "変更なし"}` : "") },
              { label:"契約の更新", value: disp(job.contractRenewal) },
              { label:"労災・雇用保険", value: disp(job.laborInsuranceStatus) },
            ].map(row => (
              <div key={row.label} style={{ padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
                <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", display:"block", marginBottom:2, textAlign:"center" }}>{row.label}</span>
                {/* 持ち物＝アイコンつきタグチップ（2026-08-28・旧📌チップの置き換え。分割・アイコン対応は BelongingChips に一本化） */}
                {row.chips && row.value !== "ー"
                  ? <BelongingChips text={String(row.value)} />
                  : <span className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.6, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word", display:"block", textAlign:"center" }}>{row.value}</span>}
              </div>
            ))}
          </div>

          {/* 危険区域セクション（両方空なら見出しごと非表示） */}
          {((job.dangerPlaces && job.dangerPlaces.length > 0) || (job.dangerTasks && job.dangerTasks.length > 0)) && (
          <div style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:20, ...revOutline("危険箇所") }}>
            {revChip("危険箇所")}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:20 }}>
              <span style={{ display:"flex", color:"#E8A33D" }}><NavIcon name="alert" size={18} /></span>
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
            {/* 番地まで明記する画面ので、Googleマップ導線にも番地を渡す（2026-08-03）。
                ピン自体は従来どおり町域重心＝addressShownで注記の文言を実態に合わせる */}
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

          {/* 保険カード（カレンダーの下・2026-08-19たきと指示。求人詳細・確認ページと同じ位置） */}
          {/* 見るのは掲載時に凍結された insuranceSnapshot だけ（2026-08-02・プロフィール現在値への
              フォールバック禁止）。掲載前の下書きはまだ凍結されていない＝区画ごと出ない
              （そこでの見え方は求人フローの確認ページthaが受け持つ）。
              複数枚は指連動の横スワイプ＝中の .carousel-scroll は公開の右スワイプthaが掴まない（L138の除外） */}
          {job.insuranceSnapshot && (
            <JobInsuranceSection
              style={{ position:"relative", marginBottom:20, ...revOutline("保険") }}
              employer={{ insurance_items: job.insuranceSnapshot.items, insurance_notes: job.insuranceSnapshot.notes }}>
              {revChip("保険")}
            </JobInsuranceSection>
          )}
        </>)}
      </div>
      </div>

      {/* 本人ビューの操作ボタンはこのシートに置かない（2026-08-07〜08たきと指示）＝
          再開・削除・コピー・非公開はすべて求人一覧ページの浮遊ピル（FarmerDashboardの
          .cb-job-action-fabs）に集約。このシートは閲覧専用＝実行の窓口を1箇所に保つ */}

      {/* 下部の操作バー（審査のみ・2026-08-05たきと指示・下余白5px固定）。
          公開するボタンは廃止＝右スワイプに置換（2026-08-07たきと指示）。案内文も出さない
          （同日たきと指示「管理者は僕だから説明は不要」）＝修正を依頼がバーの幅を広く取る。
          「修正を依頼」は2段構え：押すと指摘チップthaが現れるモードに入り、0件のままもう一度押すと
          やめる、1件以上で押すと送信。zIndex=公開の緑面より上（バーは常に見える） */}
      {!ownerView && (
        <div style={{ flexShrink:0, display:"flex", alignItems:"center", gap:8, background:"#fff", borderTop:"1px solid #EBEBEB",
          padding:"10px 12px 5px", position:"relative", zIndex:2 }}>
          <button onClick={onClose} className="f-sans" style={{ flexShrink:0, padding:"13px 18px", fontSize:14, fontWeight:600, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:12, cursor:"pointer" }}>閉じる</button>
          <button
            onClick={!revMode ? ()=>setRevMode(true) : (findings.length > 0 ? submitRevision : ()=>{ setRevMode(false); })}
            disabled={!job || revSending} className="f-sans"
            style={{ flex:1, padding:"13px 0", fontSize:14, fontWeight:700,
              background: (revMode && findings.length > 0) ? "#EA580C" : "#fff",
              color: (revMode && findings.length > 0) ? "#fff" : "#EA580C",
              border:"1px solid #EA580C", borderRadius:12, cursor:"pointer", opacity: (job && !revSending) ? 1 : 0.6 }}>
            {revSending ? <>送信中<Dots /></> : !revMode ? "修正を依頼" : findings.length > 0 ? `修正を依頼（${findings.length}）を送信` : "指摘をやめる"}
          </button>
        </div>
      )}

      {/* 危険箇所の写真ライトボックス（全画面拡大） */}
      {dangerLightbox && (
        <div className="cb-lock-scroll" onClick={() => setDangerLightbox(null)} style={{
          position:"fixed", inset:0, zIndex:10000,
          background:"rgba(0,0,0,0.92)",
          display:"flex", alignItems:"center", justifyContent:"center",
          cursor:"pointer", animation:"fadeIn .2s ease", padding:16,
        }}>
          <img src={dangerLightbox} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain", borderRadius:8 }} />
        </div>
      )}

      {/* 指摘エディタ（2026-07-19）：項目の「指摘」タップで開く。何がどう問題かを選んで補足を書く */}
      {editTarget && createPortal(
        <div className="cb-lock-scroll" onClick={()=>setEditTarget(null)} style={{ position:"fixed", inset:0, zIndex:10050, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:420, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#EA580C", margin:"0 0 4px" }}>この項目を指摘</p>
            <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:"0 0 14px" }}>【{editTarget}】</p>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#222", margin:"0 0 8px" }}>どう問題ですか？</p>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
              {JOB_REVISION_ISSUE_TYPES.map(t => (
                <button key={t} onClick={()=>setEditIssue(t)} className="f-sans" style={{ padding:"8px 12px", borderRadius:20, border: editIssue === t ? "2px solid #EA580C" : "1px solid #EBEBEB", background: editIssue === t ? "#FFF1E7" : "#fff", fontSize:12, fontWeight:600, color: editIssue === t ? "#EA580C" : "#717171", cursor:"pointer" }}>{t}</button>
              ))}
            </div>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#222", margin:"0 0 8px" }}>何がダメか・どう直すか（任意）</p>
            <textarea value={editNote} onChange={e=>setEditNote(e.target.value)} placeholder="例：日給が最低賃金を下回っています。実働の時間で割った金額が、その地域の最低賃金以上になるようにしてください。" rows={3} className="field f-sans" style={{ fontSize:13, marginBottom:14, resize:"vertical" }} />
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
        <div className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:10060, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:24, animation:"fadeIn .2s ease" }}>
          <div className="cb-sheet-up" style={{ background:"#fff", borderRadius:16, padding:"28px 24px", maxWidth:340, width:"100%", textAlign:"center" }}>
            <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 6px" }}>修正依頼を送りました</p>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.7, margin:0 }}>農家にチャットとメールで届きます。求人は「作成中」に戻ります。</p>
          </div>
        </div>,
        document.body
      )}

    </div>
    </div>,
    document.body
  );
}
