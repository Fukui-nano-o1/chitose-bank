// 下から生えるボックスの共有シート（2026-08-08たきと指示「ステータスページのボックスと同じ
// 規格や枠、非表示条件にしよう」＝応募者ページのボックスを揃えるために切り出した）。
// 規格の出どころ＝ステータスページの展開ボックス（SavedJobsView・boxJob）。
// ★枠・非表示条件・面の動きを変えるときは SavedJobsView 側と揃えること（あちらは実装that先行・
//   inlineのまま＝この部品をまだ使えていないので手で同期する）。
//
// 【枠】暗幕（背景タップで閉じる）＋下から生える全画面シート（top:6vh・maxWidth:560・
//   角丸は上だけ20px・✕なし・上部中央にグラバー40x4）＋中身のスクロール領域。
// 【非表示条件】①背景タップ ②下スワイプ＝中身が最上部（scrollTop<=0）のとき下向きドラッグthatが
//   シートを掴み、指に連動（rAFで1フレーム1回・will-changeで自前レイヤー・基点の置き直し＝滑らか3点セット）。
//   引き下げたシートの上端が画面の縦中央より下で指を離すと閉じる／上なら定位置へ戻す。
// 【面の2枚構造（任意・detailを渡した時だけ）＝ステータスボックスと同じ動き（2026-08-08「アニメーションもコピー」）】
//   [詳細面｜メイン面] を横に並べ、showcase=true でメイン面全体が cbJobShowcase
//   （縮む→一拍→小さいまま右へスライドアウト）。終わった合図（onShowcaseEnd）で親が pane="detail" にすると
//   面が右へずれて左から詳細面が現れる。詳細面では横スワイプ（指に連動・左1:1・右ゴム抵抗・
//   しきい値=幅35%/最大140px）で onPaneChange("main")＝戻る。写真カルーセル内のタッチは写真スクロールに譲る。
import { useEffect, useRef } from "react";

export function DragSheet({ onClose, children, detail, pane = "main", onPaneChange, showcase = false, onShowcaseEnd }) {
  const sheetRef = useRef(null);
  const scrollRef = useRef(null);
  const paneRef = useRef(null);
  const hasPanes = detail !== undefined;
  // コールバック・最新状態はrefで読む（リスナーはマウント時に1回だけ張る）
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const onPaneChangeRef = useRef(onPaneChange); onPaneChangeRef.current = onPaneChange;
  const paneStateRef = useRef(pane); paneStateRef.current = pane;
  const hasPanesRef = useRef(hasPanes); hasPanesRef.current = hasPanes;
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.willChange = "transform";
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
          // 縦：下向き＆中身が最上部のときだけシートを掴む。上向き・スクロール余地あり＝通常スクロールに譲る
          const sc = scrollRef.current;
          if (dy > 0 && (!sc || sc.scrollTop <= 0)) {
            axis = "v"; baseY = cy; el.style.transition = "none";
            baseTop = el.getBoundingClientRect().top; // 掴んだ瞬間の定位置（この時点でtransformは0）
          } else { tracking = false; return; }
        } else {
          // 横：詳細面のときだけ「戻る」ジェスチャとして面を掴む。カルーセル内は写真スクロールに譲る
          if (!hasPanesRef.current || paneStateRef.current !== "detail") { tracking = false; return; }
          if (e.target.closest && e.target.closest(".carousel-scroll")) { tracking = false; return; }
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
        setTimeout(() => onCloseRef.current && onCloseRef.current(), 220);
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
        onPaneChangeRef.current && onPaneChangeRef.current("main");
      } else {
        p.style.transition = "transform .3s ease";
        p.style.transform = "translateX(0)";
      }
    };
    const onEnd = () => {
      if (!tracking) return;
      const a = axis; axis = null; tracking = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      // 畳む発火＝引き下げたシートの上端が画面中央より下まで来ている時だけ（指の座標では判定しない）
      if (a === "v") settleV(baseTop + lastY > window.innerHeight / 2);
      else if (a === "h") settleH(Math.abs(lastX) > Math.min(140, paneW * 0.35));
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
    // ReactのonTouchMoveはルートでpassive登録されpreventDefaultが効かないため、ネイティブ{passive:false}
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
  }, []);
  return (
    <div onClick={() => onCloseRef.current && onCloseRef.current()} className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
      <div ref={sheetRef} onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:0, right:0, top:"6vh", bottom:0, maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:"20px 20px 0 0", display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div aria-hidden="true" style={{ flexShrink:0, display:"flex", justifyContent:"center", padding:"10px 0 2px" }}>
          <span style={{ width:40, height:4, borderRadius:2, background:"#E0E0E0" }} />
        </div>
        <div ref={scrollRef} style={{ flex:1, overflowY:"auto", overflowX:"hidden", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding: hasPanes ? "12px 0 calc(16px + env(safe-area-inset-bottom, 0px))" : "12px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
          {hasPanes ? (
            <div ref={paneRef} style={{ display:"flex", width:"200%", transform: pane === "detail" ? "translateX(0)" : "translateX(-50%)", transition:"transform .35s ease" }}>
              {/* 面2：詳細（左側に置く＝右ずれの動きで現れる） */}
              <div style={{ width:"50%", boxSizing:"border-box", padding:"0 16px" }}>
                {pane === "detail" ? detail : null}
              </div>
              {/* 面1：メイン。showcase中は面全体that縮む→一拍→右へスライドアウト（cbJobShowcase・fill both）。
                  ★onAnimationEndはtarget一致で絞る（中の写真ポップ等thatバブルしてくるため） */}
              <div className={showcase ? "cb-job-showcase" : undefined}
                onAnimationEnd={(e)=>{ if (e.target === e.currentTarget && showcase && onShowcaseEnd) onShowcaseEnd(); }}
                style={{ width:"50%", boxSizing:"border-box", padding:"0 16px" }}>
                {children}
              </div>
            </div>
          ) : children}
        </div>
      </div>
    </div>
  );
}
