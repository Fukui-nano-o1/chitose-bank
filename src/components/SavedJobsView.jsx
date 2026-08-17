// ステータス一覧（#/saved・分割・段階2後半・2026-07-24／2026-07-27に役割を刷新）：
// 働き手が「いいね」「応募」した求人と、その求人での自分の段階を確認する面。
// 2026-07-27たきと指示：雇い手の応募者ページと同じ構造（左=求人トップ写真＋タイトル/#No.／右=アイコン）に。
// ★アイコンは「自分のもの」だけ＝自分の応募がいまどの段階かを確認するための面。
//   他の働き手の情報（誰が応募しているか・人数）は取得も表示も一切しない（データ憲法・個人情報の最小化）。
// ★求人の供給源は my_job_actions()（SECURITY DEFINER・2026-07-27）。jobs_public は status='open' しか
//   含まないため、応募した求人が掲載終了すると一覧から消えていた（＝失効・完了の暗幕が出なかった）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { ymdLocal, appPhaseKey, APP_PHASE_LABEL, APP_PHASE_COLOR, APP_PHASE_DESC, CHAT_ELIGIBLE_STATUSES, photoThumb, mapJobPublicRow } from "../lib/utils";
import { JobCard } from "./JobCard";
import { JobDetailBody } from "./JobDetailBody";
import { openPhaseInfo } from "../lib/previewBus";
import { Avatar, AutoSkeleton, useSkeletonProbe, FlowBar } from "./ui";
import { AgreedDatesRow, AvailDatesChips } from "./DateChips";
import { getCache, setCache } from "../lib/viewCache";
import { MyCalendar } from "./MyCalendar";

// ── SavedJobsView（ステータス一覧・#/saved） ──
export function SavedJobsView({ me }) {
  // 前回の内容が残っていればまず出す→裏で最新に差し替える（2026-07-27たきと指示・遷移の待ち時間対策）
  const [rows, setRows] = useState(() => getCache("saved:rows") ?? null);
  const [myProfile, setMyProfile] = useState(() => getCache("saved:me") ?? null); // 自分のアイコン・ニックネーム
  const [boxJob, setBoxJob] = useState(null);       // 展開中のボックス（求人1件・応募者ページのシートと同じ作法）
  // ボックス内の求人カード用の全体像（2026-08-07たきと指示「その他の求人と同じ配置と要素」＝JobCard）。
  // my_job_actions はカードの最小限（報酬・地域・3トグルを含まない）so、開いた求人だけ jobs_public から
  // 1行読み足す。job_number→mapped行｜null(非公開=draft/pending等でビューに無い)。開いたものだけ・1回だけ
  const [boxFull, setBoxFull] = useState({});
  // ボックス内の求人カードのタップ（2026-08-07たきと指示「求人タップでスライドしてね。
  // そこで、求人詳細の確認しよう」）：タップ＝cbJobShowcase（縮む→一拍→大きく→右へスライドアウト）を
  // 再生し、終わった合図で面を求人詳細パネルへスライドする。ページ遷移はしない。
  // boxPane: "main"＝要約・日にち・操作ボックス／"detail"＝求人詳細の確認パネル
  const [cardShow, setCardShow] = useState(false);
  const [boxPane, setBoxPane] = useState("main");
  // ボックスの下スワイプで畳む（2026-08-07たきと指示「下スクロールはボックスを畳む。指に連動。
  // 画面中央より下で指が離れたなら畳む」）：
  // ・シート内の中身が最上部（scrollTop<=0）のときだけ、下向きのドラッグがシートを掴む＝
  //   スクロールの余地がある間は通常スクロール（上に読み戻す動作を奪わない）
  // ・掴んだらtransform直書きで指に追従（毎フレーム再レンダーしない＝今日ページのスワイプと同じ作法）
  // ・指が離れた位置が画面の縦中央より下なら下へ滑らせて閉じる／上なら定位置へ戻す
  // ・ReactのonTouchMoveはルートでpassive登録されpreventDefaultが効かないため、ネイティブリスナー
  //   {passive:false}で張る（2026-08-02今日ページ・TodayPageと同じ理由）
  const sheetRef = useRef(null);
  const boxScrollRef = useRef(null);
  const paneRef = useRef(null);      // 面の2枚コンテナ（横スワイプの追従対象）
  const boxPaneRef = useRef("main"); // リスナーは[boxJob]で1回張るso、最新の面はrefで読む
  useEffect(() => { boxPaneRef.current = boxPane; }, [boxPane]);
  // 面の切り替えとスクロール位置（2026-08-08たきと指示「スライドしたならトップから始めろ。
  // ステータスページも同じにしろ」＝DragSheetと同じ規則）：詳細面に入る時はトップから。
  // メイン面のスクロール位置は覚えておき、戻った時に復元する（読みかけの位置を失わない）
  const boxScrollSavedRef = useRef(0);
  useEffect(() => {
    const sc = boxScrollRef.current;
    if (!sc) return;
    if (boxPane === "detail") { boxScrollSavedRef.current = sc.scrollTop; sc.scrollTop = 0; }
    else { sc.scrollTop = boxScrollSavedRef.current || 0; }
  }, [boxPane]);
  // ジェスチャは1本のパイプラインで軸ロック（2026-08-07たきと指示「左右スワイプで戻って。
  // 戻るは削除。指に連動させるが滑らかに」で横を追加）：
  // ・8px動いた時点で縦か横かを1ジェスチャ1回だけ確定（TodayPage・AdminJobPreviewと同じ作法）
  // ・縦＝下向き＆中身が最上部のときシートを掴む→引き下げ位置が画面中央より下で離すと畳む（従来）
  // ・横＝詳細面のときだけ面コンテナを掴む→指に連動（左=戻る方向は1:1・右=行き先が無いのでゴム抵抗）。
  //   しきい値（幅35%・最大140px）を超えて離すとメイン面へ、未満なら詳細面へ戻す。
  //   写真カルーセル内で始まったタッチは写真スクロールに譲る
  // ・滑らかさの3点セット（同日「かくかくだ」の修理）：will-change＝自前の合成レイヤー／
  //   書き込みはrequestAnimationFrameで1フレーム1回／掴んだ瞬間に基点を置き直す（跳びゼロ）
  useEffect(() => {
    const el = sheetRef.current;
    if (!boxJob || !el) return;
    el.style.transform = ""; el.style.transition = ""; // 開き直し・求人切り替えの残骸を消す
    el.style.willChange = "transform";
    // ★面コンテナの残骸掃除は「空文字」でなく現在の面の定位置を書く（2026-08-07「ボックスが真っ白」の修理）：
    //   transform="" にするとReactthaが与えた translateX(-50%)（メイン面の位置）まで消え、コンテナthaが
    //   空の詳細面を向いたまま固定＝真っ白に見えた。Reactは自分の前回値と同じ間は書き直さないため、
    //   手動で消した値は手動で正しい値に戻すこと（settleHの注記と同じ罠）
    if (paneRef.current) {
      paneRef.current.style.transition = "transform .35s ease"; // ""にするとReactの.35sも消えたまま戻らない（同じ罠）
      paneRef.current.style.transform = boxPaneRef.current === "detail" ? "translateX(0)" : "translateX(-50%)";
    }
    let sx = 0, sy = 0, baseY = 0, baseTop = 0, lastY = 0, lastX = 0, paneW = 1, axis = null, tracking = false, raf = 0;
    const paint = () => {
      raf = 0;
      if (axis === "v") el.style.transform = `translateY(${lastY}px)`;
      else if (axis === "h" && paneRef.current) paneRef.current.style.transform = `translateX(${lastX}px)`;
    };
    const onStart = (e) => {
      if (e.touches.length !== 1) { tracking = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; axis = null; tracking = true;
    };
    const onMove = (e) => {
      if (!tracking) return;
      const cx = e.touches[0].clientX, cy = e.touches[0].clientY;
      const dx = cx - sx, dy = cy - sy;
      if (!axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // 8px動くまで判定保留
        if (Math.abs(dy) >= Math.abs(dx)) {
          // 縦：下向き＆最上部のときだけシートを掴む。上向き・スクロール余地あり＝通常スクロールに譲る
          const sc = boxScrollRef.current;
          if (dy > 0 && (!sc || sc.scrollTop <= 0)) {
            axis = "v"; baseY = cy; el.style.transition = "none";
            baseTop = el.getBoundingClientRect().top; // 掴んだ瞬間の定位置（この時点でtransformは0）
          } else { tracking = false; return; }
        } else {
          // 横：詳細面のときだけ「戻る」ジェスチャとして面を掴む（メイン面の横スワイプは何もしない）
          if (boxPaneRef.current !== "detail") { tracking = false; return; }
          // 写真カルーセル＝写真送りに譲る／タブの中身（.cb-content-swipe）＝タブ切替に譲る（2026-08-08・
          // 端でのスワイプはContentQSwipeAreaのonEdgeSwipe→onBackで面that戻る）
          if (e.target.closest && (e.target.closest(".carousel-scroll") || e.target.closest(".cb-content-swipe"))) { tracking = false; return; }
          const p = paneRef.current; if (!p) { tracking = false; return; }
          axis = "h"; paneW = el.clientWidth || 1;
          p.style.transition = "none"; p.style.willChange = "transform";
        }
      }
      e.preventDefault();
      if (axis === "v") lastY = Math.max(0, cy - baseY);
      else lastX = dx < 0 ? Math.max(dx, -paneW) : Math.min(dx * 0.25, 40); // 左=1:1／右=ゴム抵抗
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const settleV = (toClose) => {
      if (toClose) {
        el.style.transition = "transform .22s ease";
        el.style.transform = "translateY(105%)";
        setTimeout(() => setBoxJob(null), 220);
      } else {
        el.style.transition = "transform .25s ease";
        el.style.transform = "translateY(0)";
      }
    };
    const settleH = (goBack) => {
      const p = paneRef.current; if (!p) return;
      p.style.willChange = "";
      if (goBack) {
        // 手動のtransition:noneをReactの値に戻してから面を切り替える＝いまの指の位置から滑らかに-50%へ。
        // ★Reactはtransitionを書き換えない（diff上は不変）ため、手動で戻さないと'none'のまま跳ぶ
        p.style.transition = "transform .35s ease";
        setBoxPane("main"); setCardShow(false);
      } else {
        p.style.transition = "transform .3s ease";
        p.style.transform = "translateX(0)";
      }
    };
    const onEnd = () => {
      if (!tracking) return;
      const a = axis; axis = null; tracking = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (a === "v") {
        // 畳む発火＝指を離した時、引き下げたボックス（掴んでいる上端）が画面中央より下まで来ている時だけ。
        // ★指の画面座標で判定しない（2026-08-07「まだ下スクロールで畳む」の修理）
        settleV(baseTop + lastY > window.innerHeight / 2);
      } else if (a === "h") {
        settleH(Math.abs(lastX) > Math.min(140, paneW * 0.35));
      }
      lastX = 0; lastY = 0;
    };
    const onCancel = () => {
      if (!tracking) return;
      const a = axis; axis = null; tracking = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (a === "v") settleV(false);
      else if (a === "h") settleH(false);
      lastX = 0; lastY = 0;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, [boxJob]);
  useEffect(() => {
    setCardShow(false); setBoxPane("main"); // 開き直し・別の求人への切り替えで演出・面の残骸を持ち越さない
    const jn = boxJob?.job_number;
    if (!jn || jn in boxFull) return;
    let dead = false;
    (async () => {
      try {
        const { data } = await supabase.from("jobs_public").select("*").eq("job_number", jn).maybeSingle();
        if (!dead) setBoxFull(prev => ({ ...prev, [jn]: data ? mapJobPublicRow(data) : null }));
      } catch { if (!dead) setBoxFull(prev => ({ ...prev, [jn]: null })); }
    })();
    return () => { dead = true; };
  }, [boxJob]); // eslint-disable-line react-hooks/exhaustive-deps -- boxFullは取得済み判定のみ（依存に入れると再取得ループ）
  const [legendOpen, setLegendOpen] = useState(false); // 下部「ステータスの意味」の開閉（応募者ページの凡例と同じ）
  // カレンダー（2026-07-27たきと指示）：働き手のカレンダーページを廃止し、この面の上部へ移植。
  // 開閉は雇い手の応募者ページと同じ作法＝横スワイプ or 案内行のタップ。今日ページのカレンダー箱から
  // 来たときは合図(cb_openCalendar)で開いた状態で着地する
  const [calOnTop, setCalOnTop] = useState(false);
  const [calDay, setCalDay] = useState(null); // { ymd, jobs:[job_number] }＝選んだ日の求人を光らせる
  // 畳む動作は開く動作の逆順（①縦に畳む→②横に縮む・2026-07-29たきと指示）。応募者ページと同じ作法
  const [calClosing, setCalClosing] = useState(false);
  const calCloseT = useRef(null);
  const CAL_CLOSE_MS = 660; // CSS: 縦0.34s +（0.34s待ち）横0.3s ＝ 0.64s ＋ 余白
  useEffect(() => () => clearTimeout(calCloseT.current), []);
  const toggleCalTop = () => {
    if (calOnTop) {
      if (calClosing) return;
      setCalClosing(true);
      setCalDay(null);
      calCloseT.current = setTimeout(() => { setCalOnTop(false); setCalClosing(false); }, CAL_CLOSE_MS);
    } else {
      clearTimeout(calCloseT.current);
      setCalClosing(false);
      setCalOnTop(true);
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); }
    }
  };
  const jobCardRefs = useRef({});
  // 仮配置の骨を測るref（このページが実際に描いた形が、次回の読み込み中の形になる）
  const skelRef = useSkeletonProbe("saved");
  useEffect(() => {
    try { if (sessionStorage.getItem("cb_openCalendar")) { sessionStorage.removeItem("cb_openCalendar"); setCalOnTop(true); } } catch {}
  }, []);
  const onCalDayTap = (ymd, jobNumbers) => {
    setCalDay({ ymd, jobs: jobNumbers });
    if (!jobNumbers.length) return;
    setTimeout(() => {
      const el = jobNumbers.map(n => jobCardRefs.current[n]).find(Boolean);
      if (el) el.scrollIntoView({ behavior:"smooth", block:"center" });
    }, 40);
  };
  // 横スワイプでカレンダーを開閉（応募者ページと同じ判定。内側の横スクロールで始まったタッチは奪わない）
  const swipeRef = useRef(null);
  const onSwipeStart = (e) => {
    const inHScroll = (() => {
      for (let n = e.target; n && n !== e.currentTarget; n = n.parentElement) {
        try {
          const st = window.getComputedStyle(n);
          if ((st.overflowX === "auto" || st.overflowX === "scroll") && n.scrollWidth > n.clientWidth + 1) return true;
        } catch { return true; }
      }
      return false;
    })();
    swipeRef.current = inHScroll ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onSwipeEnd = (e) => {
    const s = swipeRef.current; swipeRef.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return; // 横スワイプのみ
    toggleCalTop();
  };
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [actRes, wpRes] = await Promise.all([
          supabase.rpc("my_job_actions"),
          supabase.from("worker_profiles").select("nickname,avatar_url").eq("auth_id", me.id).maybeSingle(),
        ]);
        if (cancelled) return;
        setRows(actRes.data || []); setCache("saved:rows", actRes.data || []);
        setMyProfile(wpRes.data || null); setCache("saved:me", wpRes.data || null);
      } catch { if (!cancelled) setRows([]); }
    })();
    return () => { cancelled = true; };
  }, [me?.id]);

  // いいね解除。応募のある求人はステータス確認のため一覧に残す（消えるのは「いいねだけ」の求人）。
  // 誤タップ救済に「元に戻す」を10秒出す（2026-07-27）
  const [undoJob, setUndoJob] = useState(null);
  const [cancelingId, setCancelingId] = useState(null); // 応募の取り消し中（多重送信ガード）
  const handleUnsave = async (r) => {
    setRows(prev => (prev || []).flatMap(x => x.job_number !== r.job_number ? [x] : (x.application_id ? [{ ...x, liked: false }] : [])));
    setUndoJob(r);
    setTimeout(() => setUndoJob(prev => (prev && prev.job_number === r.job_number) ? null : prev), 10000);
    await supabase.from("saved_jobs").delete().eq("worker_id", me.id).eq("job_number", r.job_number);
  };
  const handleUndo = async () => {
    const r = undoJob; if (!r) return;
    setUndoJob(null);
    const { error } = await supabase.from("saved_jobs").insert({ worker_id: me.id, job_number: r.job_number });
    if (error) { alert("戻せませんでした：" + error.message); return; }
    setRows(prev => {
      const has = (prev || []).some(x => x.job_number === r.job_number);
      const next = has ? (prev || []).map(x => x.job_number === r.job_number ? { ...x, liked: true } : x)
                       : [{ ...r, liked: true }, ...(prev || [])];
      return next.sort((a, b) => b.job_number - a.job_number);
    });
  };

  // 応募の取り消し（2026-08-16たきと指示「応募を取り消すを追加しよう」）。
  // このボックスは応募中の応募だと操作that1つも無かった（チャットは承認後so出ない）＝
  // 応募状況ページ・求人詳細と同じ窓口（cancel_application）をここにも置く。
  // ★取り消せるのは承認前（応募中）だけ＝DB側も status='applied' 限定（それ以外は already_decided）so、
  //   ボタンも応募中のときだけ出す。取り消しは削除でなく記録＝カードは「取り消し」の暗幕に変わる
  const cancelApplication = async (r) => {
    if (cancelingId || !r.application_id) return;
    if (!window.confirm("この応募を取り消しますか？農家にお知らせが届きます")) return;
    setCancelingId(r.application_id);
    try {
      const { data, error } = await supabase.rpc("cancel_application", { p_application_id: r.application_id });
      // ok（already=既に取り消し済みも含む）／not_found＝行that既に無い（旧実装の残り）＝どちらも取り消し済み扱い
      if (!error && data && (data.ok || data.reason === "not_found")) {
        setRows(prev => (prev || []).map(x => x.job_number === r.job_number
          ? { ...x, application_status: "canceled" } : x));
        setBoxJob(null);
      } else {
        alert("取り消しに失敗しました：" + (data?.reason || error?.message || "不明"));
      }
    } catch { alert("取り消しに失敗しました。"); }
    setCancelingId(null);
  };

  // 初回（キャッシュ無し）は空白でなく仮の箱を並べる＝読み込み中がひと目で分かる
  if (rows === null) return <div style={{ paddingTop:4 }}><AutoSkeleton shapeKey="saved" /></div>;

  const photoOf = (r) => photoThumb(r.photos?.[0]);
  const titleOf = (r) => [r.crop, r.task].filter(Boolean).join(" ") || `求人 #${r.job_number}`;
  // 応募行の形（appPhaseKeyは status＋terms_confirmed_* から段階を導く。帯の唯一のソース）
  const appOf = (r) => r.application_id ? {
    id: r.application_id, status: r.application_status,
    terms_confirmed_worker_at: r.terms_confirmed_worker_at,
    terms_confirmed_farmer_at: r.terms_confirmed_farmer_at,
  } : null;
  // 見送り・失効のアイコンは「その時の状態」で出す（2026-07-27たきと指示）。どちらも応募中から進まずに
  // 終わった応募なので、アイコンは応募中のまま。終わった事実はカード全体の暗幕＋ラベルが担う
  const phaseOf = (r) => { const a = appOf(r); return a ? appPhaseKey((a.status === "expired" || a.status === "rejected" || a.status === "canceled") ? { ...a, status: "applied" } : a) : null; };
  // openJobPage（求人ページへの遷移）は削除（2026-08-08たきと指示「ボックスの求人ページは不要」）
  // ＝ボックス内の確認は求人カードタップ→詳細面that担う。求人ページ自体は さがす から従来どおり開ける

  return (
    <div>
      {undoJob && (
        <div className="fade-in" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, background:"#F7F7F7", border:"1px solid #EBEBEB", borderRadius:12, padding:"10px 14px", marginBottom:12 }}>
          <span className="f-sans" style={{ fontSize:12, color:"#717171", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>いいねを外しました（#{undoJob.job_number}）</span>
          <button onClick={handleUndo} className="f-sans" style={{ flexShrink:0, background:"none", border:"none", fontSize:13, fontWeight:700, color:"#00A86B", textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>元に戻す</button>
        </div>
      )}
      {/* 展開はヌルッと（2026-07-27たきと指示）：cb-cal-revealが高さ0→自動へ滑らかに開く */}
      {(calOnTop || calClosing) && <div className={"cb-cal-reveal" + (calClosing ? " cb-cal-closing" : "")} style={{ marginBottom:14 }}><div><MyCalendar onDayTapJobs={onCalDayTap} /></div></div>}
      {rows.length > 0 && (
        <button onClick={toggleCalTop} className="f-sans"
          style={{ width:"100%", background:"none", border:"none", padding:"0 0 6px", fontSize:11, color:"#B0B0B0", textAlign:"center", cursor:"pointer" }}>
          {(calOnTop && !calClosing) ? "横スワイプでカレンダーを畳む" : "📅 横スワイプでカレンダーを開く"}
        </button>
      )}
      {rows.length === 0 ? (
        <div style={{ textAlign:"center", padding:"80px 24px" }}>
          <div style={{ fontSize:40, marginBottom:16, color:"#E24B4A" }}>♡</div>
          <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.7 }}>気になる求人を♥しておくと、ここに並びます</p>
        </div>
      ) : (
        <div ref={skelRef} onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd} style={{ display:"grid", gap:10 }}>
          {rows.map(r => {
            const photo = photoOf(r);
            const title = titleOf(r);
            // 終わった応募・求人は暗幕＋中央ラベル＋タップ無反応（応募者ページと同設計）。
            // 見送り(rejected)も失効と同じ構造にする（2026-07-27たきと指示）＝日程に関係なく暗幕。
            // ラベルの優先順：完了 ＞ 掲載取り下げ（rejected_reason='unpublished'・2026-08-08たきと指示
            // 「掲載取り下げにしよう」＝農家の選考でなく掲載の取り下げ＝働き手の不利益に読ませない）
            // ＞ 見送り（農家の判断） ＞ 失効（判断なきまま日程を過ぎた）
            const jobEnd = r.date_end || r.date_start;
            const jobPast = !!jobEnd && jobEnd < ymdLocal(new Date());
            const isRejected = r.application_status === "rejected";
            const isWithdrawn = isRejected && r.rejected_reason === "unpublished";
            const isCanceled = r.application_status === "canceled";
            // ★失効そのものも暗幕の対象にする（2026-08-16）：失効は作業の【開始時刻】に自動で起きるため、
            //   期間求人だと最終日までは jobPast that偽＝暗幕も「失効」ラベルも出ないまま応募中に見えていた
            const isExpired = r.application_status === "expired";
            const jobCompleted = r.application_status === "completed";
            const covered = jobPast || isRejected || isCanceled || isExpired || jobCompleted;
            const coverLabel = jobCompleted ? "完了" : isWithdrawn ? "掲載取り下げ" : isRejected ? "見送り" : isCanceled ? "取り消し" : "失効";
            const coverColor = jobCompleted ? "#607D8B" : isWithdrawn ? "#757575" : isRejected ? APP_PHASE_COLOR.rejected : isCanceled ? APP_PHASE_COLOR.canceled : "#111";
            const phase = phaseOf(r);
            // カレンダーで選んだ日に該当する求人は光らせる（応募者ページと同じ引き継ぎ）
            const calHit = !!calDay && calDay.jobs.includes(r.job_number);
            return (
              <div key={r.job_number} ref={el => { jobCardRefs.current[r.job_number] = el; }}
                style={{ position:"relative", display:"flex", alignItems:"stretch", background: calHit ? "#FFF6DE" : "#fff", border:"1px solid " + (calHit ? "#E8C77A" : "#EBEBEB"), borderRadius:14, overflow:"hidden", transition:"background .5s", pointerEvents: covered ? "none" : undefined }}>
                {covered && (
                  <div style={{ position:"absolute", inset:0, zIndex:2, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <span className="f-sans" style={{ background: coverColor, color:"#fff", fontSize:13, fontWeight:800, borderRadius:8, padding:"6px 20px", letterSpacing:"0.15em" }}>{coverLabel}</span>
                  </div>
                )}
                {/* 左：求人のトップ写真。タイトル・#No.を写真下部に重ねる（応募者ページと同じ作法）。
                    タップ＝ボックス展開（2026-07-27たきと指示。求人ページへの直行はボックス内のボタンが担う） */}
                <button onClick={()=>setBoxJob(r)} aria-label="この求人の状況を開く" className="f-sans"
                  /* 写真の枠は3:4で固定（2026-07-27たきと指示「3番目のカードだけ低い」の修正）：
                      以前は高さ指定が無く、写真の縦横比がそのままカードの高さになっていた＝
                      横長の写真の求人だけカードが低くなっていた。枠を固定し中身はcoverで切り抜く */
                  style={{ flexShrink:0, width:104, aspectRatio:"3 / 4", padding:0, border:"none", borderRight:"1px solid #F0F0F0", background:"#F2F2F2", cursor:"pointer", position:"relative", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, textAlign:"left" }}>
                  {photo ? <img src={photo} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover", filter: covered ? "grayscale(70%)" : "none" }} /> : "🌱"}
                  <span style={{ position:"absolute", left:0, right:0, bottom:0, padding:"18px 8px 7px", background:"linear-gradient(transparent, rgba(0,0,0,0.72))", boxSizing:"border-box" }}>
                    <span style={{ display:"block", fontSize:13, fontWeight:700, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>{title}</span>
                    <span style={{ display:"block", fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.82)", marginTop:1, textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>#{r.job_number}</span>
                  </span>
                </button>
                {/* 右：自分のアイコン＋自分の段階。応募していない求人は「未応募」＋求人への導線 */}
                <div style={{ flex:1, minWidth:0, padding:"10px 12px 8px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {phase ? (
                    <button onClick={()=>setBoxJob(r)} className="f-sans"
                      style={{ width:64, background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center" }}>
                      <Avatar url={myProfile?.avatar_url} name={myProfile?.nickname || (me?.name || "？")} size={52} ring={APP_PHASE_COLOR[phase] || "#00A86B"} />
                      <span style={{ display:"block", width:"100%", fontSize:11, fontWeight:600, color:"#222", marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>あなた</span>
                      <span onClick={(e)=>{ e.stopPropagation(); openPhaseInfo(phase); }} role="button" style={{ display:"block", fontSize:9, fontWeight:700, color:APP_PHASE_COLOR[phase] || "#00A86B", marginTop:1, cursor:"pointer" }}>{APP_PHASE_LABEL[phase] || ""}</span>
                    </button>
                  ) : (
                    <button onClick={()=>setBoxJob(r)} className="f-sans" style={{ background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"center" }}>
                      <span style={{ display:"block", fontSize:11, color:"#B0B0B0" }}>まだ応募していません</span>
                      <span style={{ display:"block", fontSize:12, fontWeight:700, color:"#00A86B", marginTop:4 }}>求人を見る →</span>
                    </button>
                  )}
                </div>
                {/* いいね解除（求人カードの♥と同じ役割・色も赤で統一・2026-07-27たきと指示）。
                    応募済みの求人はステータス確認のため一覧に残る（消えるのは「いいねだけ」の求人） */}
                {r.liked && (
                  <button onClick={()=>handleUnsave(r)} aria-label="いいねを解除" className="f-sans"
                    style={{ position:"absolute", top:6, right:6, zIndex:1, width:36, height:36, borderRadius:"50%", background:"rgba(255,255,255,0.92)", border:"none", cursor:"pointer", fontSize:20, lineHeight:1, color:"#E24B4A", boxShadow:"0 1px 4px rgba(0,0,0,0.15)" }}><span className="cb-like-heart" style={{ display:"inline-block" }}>♥</span></button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ステータスの意味（2026-07-27たきと指示・応募者ページ下部の凡例と同じ）。
          並び・ラベル・色・説明はすべて APP_PHASE_* から引く＝雇い手側と文言が枝分かれしない */}
      {rows.length > 0 && (
        <div style={{ marginTop:14 }}>
          <button onClick={()=>setLegendOpen(v=>!v)} className="f-sans" style={{ width:"100%", textAlign:"left", background:"#F7F7F7", border:"1px solid #EBEBEB", borderRadius:10, padding:"10px 14px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:13, fontWeight:700, color:"#555" }}>ステータスの意味</span>
            <span style={{ fontSize:14, color:"#999" }}>{legendOpen ? "－" : "＋"}</span>
          </button>
          {legendOpen && (
            <div className="fade-in" style={{ marginTop:8, background:"#fff", border:"1px solid #EBEBEB", borderRadius:10, padding:"12px 14px", display:"grid", gap:10 }}>
              {["applied","interview","contracted","working","completed","rejected","expired"].map(k => (
                <div key={k} style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                  <span className="f-sans" style={{ flexShrink:0, marginTop:1, background:APP_PHASE_COLOR[k], color:"#fff", fontSize:11, fontWeight:700, borderRadius:6, padding:"3px 8px", minWidth:56, textAlign:"center" }}>{APP_PHASE_LABEL[k]}</span>
                  <span className="f-sans" style={{ fontSize:12, color:"#555", lineHeight:1.6 }}>{APP_PHASE_DESC[k]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ 求人タップで展開するボックス（2026-07-27たきと指示・応募者ページのシートと同じ作法） ═══
           cb-lock-scroll＝展開中は背後のページを固定し、スクロールをシート内だけにする */}
      {boxJob && (() => {
        const r = boxJob;
        // ★ボックスの現在地は「本当の段階」を出す（2026-08-16たきと報告「失効ラベルが外れている」）。
        //   phaseOf は一覧のアイコン用に 失効・見送り・取り消し を応募中へ寄せる変換（終わった事実は
        //   カード全体の暗幕＋ラベルが担う＝2026-07-27の設計）that、ボックスの中には暗幕that無いので、
        //   そのまま使うと失効した応募を開いても「応募中」と出てしまい、失効のラベルが消えていた
        const appRow = appOf(r);
        const phase = appRow ? appPhaseKey(appRow) : null;
        const c = APP_PHASE_COLOR[phase] || "#717171";
        const chatOk = !!(r.application_id && CHAT_ELIGIBLE_STATUSES.includes(r.application_status));
        return (
          <div onClick={()=>setBoxJob(null)} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
            {/* ✕ボタンは削除（2026-08-07たきと指示「×削除」）＝閉じる道は下スワイプで畳む・背景タップの2つ。
                代わりに掴み手の目印（グラバー）だけ上部に置く */}
            <div ref={sheetRef} onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:0, maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:"20px 20px 0 0", display:"flex", flexDirection:"column", overflow:"hidden" }}>
              <div aria-hidden="true" style={{ flexShrink:0, display:"flex", justifyContent:"center", padding:"10px 0 2px" }}>
                <span style={{ width:40, height:4, borderRadius:2, background:"#E0E0E0" }} />
              </div>
              <div ref={boxScrollRef} style={{ flex:1, overflowY:"auto", overflowX:"hidden", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"12px 0 calc(16px + env(safe-area-inset-bottom, 0px))" }}>
                {/* ═══ 面の2枚構造（2026-08-07たきと指示「求人タップでスライドしてね。そこで、求人詳細の確認しよう」）：
                     [詳細パネル｜メイン面] を横に並べ、コンテナのtransformで切り替える。
                     カードの右スライドアウト（cbJobShowcase）が終わった合図で詳細面へ＝中身全体that右へずれて
                     左から詳細that現れる（カードの動きと同じ右方向・連続した1つの動きに見える）。
                     戻るは詳細面の「← 戻る」（cardShowも解除＝カードが定位置に戻る） ═══ */}
                <div ref={paneRef} style={{ display:"flex", width:"200%", transform: boxPane === "detail" ? "translateX(0)" : "translateX(-50%)", transition:"transform .35s ease" }}>
                {/* ── 面2：求人詳細の確認パネル（左側に置く＝右ずれの動きで現れる）。
                     中身は JobDetailBody＝求人詳細ページのボックス化（AdminJobPreview）の本文を
                     トレースした共有部品（2026-08-07たきと指示・浮遊ボックスは除外済み） ── */}
                <div style={{ width:"50%", boxSizing:"border-box", padding:"0 16px" }}>
                  {boxPane === "detail" && (() => {
                    const full = boxFull[r.job_number];
                    // 「← 戻る」ボタンは削除（2026-08-07たきと指示）＝戻りは横スワイプ（指に連動）。
                    // 案内は最上部の小さな1行だけ（操作を増やさない）
                    const swipeHint = (
                      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", textAlign:"center", margin:"0 0 10px" }}>横スワイプで戻る</p>
                    );
                    if (!full) return (
                      <div>
                        {swipeHint}
                        <p className="f-sans" style={{ fontSize:13, color:"#999", textAlign:"center", padding:"32px 0" }}>
                          {full === null ? "この求人は現在公開されていないため、詳しい内容を表示できません" : "読み込み中..."}
                        </p>
                      </div>
                    );
                    {/* 「求人ページで開く」ボタンは削除（2026-08-07たきと指示）＝
                        求人ページへの道はメイン面の📄ボックスに一本化 */}
                    return (
                      <div>
                        {swipeHint}
                        <JobDetailBody job={full} me={me} onBack={()=>{ setBoxPane("main"); setCardShow(false); }} />
                      </div>
                    );
                  })()}
                </div>
                {/* ── 面1：メイン（バナー・カード・日にち・操作ボックス） ──
                    演出の対象は面全体（2026-08-08たきと指示「求人タップで全てスライド」）：
                    カード単体でなく、バナー・カード・日にち・操作ボックスがまとまって
                    縮む→一拍→右スライドアウトし、終わった合図で詳細面へ。
                    ★onAnimationEndはtarget一致で絞る：JobCard内の写真ポップ等がバブルしてくるため、
                      絞らないと演出の途中で面が切り替わる */}
                <div className={cardShow ? "cb-job-showcase" : undefined}
                  onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && cardShow) setBoxPane("detail"); }}
                  style={{ width:"50%", boxSizing:"border-box", padding:"0 16px" }}>
                {/* 現在地バナー（応募者ページと同じ・段階色＋APP_PHASE_DESC＝説明の唯一のソース） */}
                {phase ? (
                  <div style={{ background: c + "14", borderLeft: "4px solid " + c, borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
                    <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:c, margin:0 }}>{APP_PHASE_LABEL[phase] || ""}</p>
                    {APP_PHASE_DESC[phase] && (
                      <p className="f-sans" style={{ fontSize:12, color:"#555", lineHeight:1.7, margin:"3px 0 0" }}>{APP_PHASE_DESC[phase]}</p>
                    )}
                  </div>
                ) : (
                  <div style={{ background:"#F7F7F7", borderLeft:"4px solid #B0B0B0", borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
                    <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#717171", margin:0 }}>まだ応募していません</p>
                    <p className="f-sans" style={{ fontSize:12, color:"#555", lineHeight:1.7, margin:"3px 0 0" }}>いいねした求人です。カードをタップすると内容を確認できます。応募は さがす の求人ページから。</p>
                  </div>
                )}
                {/* 求人の要約＝その他の求人と同じカード（2026-08-07たきと指示・スクショ＝関連求人カード）：
                    JobCard variant="wide"＝写真に タイトル・地域・#No.・報酬・日程・3トグル を重ねる型を全幅で。
                    要約の顔を独自に作らない＝JobCardが唯一のソース。my_job_actions は報酬・地域・3トグルを
                    持たないso、開いた求人だけ jobs_public から読み足す（boxFull）。届くまで／非公開求人は
                    手元の行から作った仮の姿（写真・タイトル・#No.・日程・町域）＝報酬0円やダミーは出さない */}
                <div style={{ marginBottom:12 }}>
                  {(() => {
                    const full = boxFull[r.job_number];
                    const job = full || {
                      id: r.job_number, crop: r.crop || "", task: r.task || "", photos: r.photos || [],
                      region: r.town || "", dateStartRaw: r.date_start || "", dateEndRaw: r.date_end || "", pay: 0,
                    };
                    // タップ＝面全体の演出を発火（cb-job-showcaseは面1のdivに付く・2026-08-08「全てスライド」）。
                    // はみ出しはスクロール容器のoverflowX:hiddenが切る
                    return <JobCard job={job} variant="wide" onOpen={()=>{ if (!cardShow) setCardShow(true); }} />;
                  })()}
                  {r.application_id && (
                    <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"8px 4px 0" }}>応募日 {new Date(r.applied_at).toLocaleDateString("ja-JP")}</p>
                  )}
                </div>
                {/* 選択した日にち（2026-08-07たきと指示）：働く日（農家が確定・濃緑）＞来られる日（応募時に自分が選んだ日）。
                    共有部品＝応募者カード・返事待ちカード・チャット文脈カードと同じ見た目。
                    'any'（期間中いつでも）・未選択は部品側で非表示（実データ／未設定／非表示の三択・憲法3条） */}
                <AgreedDatesRow value={r.agreed_dates} />
                <AvailDatesChips value={r.available_dates} />
                {/* 応募の進み具合＝常時展開（2026-08-16たきと指示「この応募状況カードを削除し、
                    カードの内容を展開したままにしよう」）。旧📋応募状況カード（→応募状況ページへの
                    遷移）を廃止し、その中身＝お仕事の流れバー（FlowBar・応募状況ページと同じ共有部品）を
                    ここに直接出す。my_job_actions は started_at 等を返さないthat、このシートを開けるのは
                    終端前（応募中〜作業中）だけ＝statusとterms確認時刻だけで各段は正しく点灯する */}
                {r.application_id && (
                  <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:18, padding:"14px 16px 12px", marginTop:12, boxShadow:"0 1px 4px rgba(0,0,0,0.04)" }}>
                    <p className="f-sans" style={{ fontSize:12, fontWeight:800, color:"#717171", margin:0 }}>📋 応募の進み具合</p>
                    <FlowBar a={{ status: r.application_status,
                      terms_confirmed_worker_at: r.terms_confirmed_worker_at,
                      terms_confirmed_farmer_at: r.terms_confirmed_farmer_at }} />
                  </div>
                )}
                {/* 操作ボックス＝横2列（2026-08-07たきと指示）。形は今日ページの「やること」箱と同型
                    （絵文字を上に・太字タイトル・中央寄せの2列格子）＝ボックス格子の作法を増やさない。
                    📄求人ページは削除（2026-08-08たきと指示「求人タップで詳細確認できるからボックスの
                    求人ページは不要」）＝内容の確認は求人カードタップ→詳細面が担う。
                    📋応募状況カードは削除（2026-08-16たきと指示）＝上の常時展開that担う */}
                {chatOk && (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:10, marginTop:12 }}>
                  <button onClick={()=>{ setBoxJob(null); window.location.hash = "/chat/" + r.application_id; }} className="f-sans"
                    style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:18, padding:"20px 10px 16px", textAlign:"center", cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.04)" }}>
                    <span style={{ display:"block", fontSize:40, lineHeight:1, marginBottom:10 }}>💬</span>
                    <span className="f-sans" style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>チャットを開く</span>
                    <span className="f-sans" style={{ display:"block", fontSize:11, color:"#717171", marginTop:4, lineHeight:1.6 }}>農家さんとのやり取り・面接はここで行います</span>
                  </button>
                </div>
                )}
                {/* 応募を取り消す（2026-08-16たきと指示）：承認前（応募中）だけ。小さくグレーで最下部
                    ＝応募状況ページの取消と同じ作法（主役は進み具合・チャット。取消は控えめに置く） */}
                {r.application_status === "applied" && (
                  <button onClick={()=>cancelApplication(r)} disabled={cancelingId === r.application_id} className="f-sans"
                    style={{ display:"block", width:"100%", textAlign:"center", marginTop:14, background:"none", border:"none", cursor:"pointer", fontSize:12, color:"#B0B0B0", textDecoration:"underline", textUnderlineOffset:3 }}>
                    {cancelingId === r.application_id ? "取り消し中..." : "応募を取り消す"}
                  </button>
                )}
                </div>{/* /面1メイン */}
                </div>{/* /面の2枚構造 */}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
