// 下から生えるボックスの共有シート（2026-08-08たきと指示「ステータスページのボックスと同じ
// 規格や枠、非表示条件にしよう」＝応募者ページのボックスを揃えるために切り出した）。
// 規格の出どころ＝ステータスページの展開ボックス（SavedJobsView・boxJob）。
// ★枠・非表示条件を変えるときは SavedJobsView 側と揃えること（あちらは面の横スワイプと
//   ジェスチャthatが1本に統合されているため、この部品をまだ使えていない＝手で同期する）。
//
// 【枠】暗幕（背景タップで閉じる）＋下から生える全画面シート（top:6vh・maxWidth:560・
//   角丸は上だけ20px・✕なし・上部中央にグラバー40x4）＋中身のスクロール領域。
// 【非表示条件】①背景タップ ②下スワイプ＝中身が最上部（scrollTop<=0）のとき下向きドラッグthatが
//   シートを掴み、指に連動（rAFで1フレーム1回・will-changeで自前レイヤー・基点の置き直し＝滑らか3点セット）。
//   引き下げたシートの上端が画面の縦中央より下で指を離すと閉じる／上なら定位置へ戻す。
//   横向きに確定したジェスチャは中身（横スクロール等）に譲る。
import { useEffect, useRef } from "react";

export function DragSheet({ onClose, children }) {
  const sheetRef = useRef(null);
  const scrollRef = useRef(null);
  // onCloseは毎レンダー新しい関数that来るので、リスナーは1回だけ張りrefで最新を呼ぶ
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.willChange = "transform";
    let sx = 0, sy = 0, baseY = 0, baseTop = 0, lastY = 0, axis = null, tracking = false, raf = 0;
    const paint = () => { raf = 0; el.style.transform = `translateY(${lastY}px)`; };
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
        } else { tracking = false; return; } // 横＝中身の横スクロールに譲る
      }
      e.preventDefault();
      lastY = Math.max(0, cy - baseY);
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const settle = (toClose) => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (toClose) {
        el.style.transition = "transform .22s ease";
        el.style.transform = "translateY(105%)";
        setTimeout(() => onCloseRef.current && onCloseRef.current(), 220);
      } else {
        el.style.transition = "transform .25s ease";
        el.style.transform = "translateY(0)";
      }
    };
    const onEnd = () => {
      if (!tracking) return;
      const a = axis; axis = null; tracking = false;
      // 畳む発火＝引き下げたシートの上端が画面中央より下まで来ている時だけ（指の座標では判定しない）
      if (a === "v") settle(baseTop + lastY > window.innerHeight / 2);
      lastY = 0;
    };
    const onCancel = () => {
      if (!tracking) return;
      const a = axis; axis = null; tracking = false;
      if (a === "v") settle(false);
      lastY = 0;
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
        <div ref={scrollRef} style={{ flex:1, overflowY:"auto", overflowX:"hidden", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"12px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
