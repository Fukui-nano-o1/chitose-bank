// 下から出るシートを「指に連動して引き下げ、離すと閉じる」共有フック（2026-08-19たきと指示
// 「画面下から出ているボックスは下にスワイプで閉じろ。指に連動させる。応募者ページのアイコンタップで
//  展開するボックスと同じ」）。
//
// ★出どころ＝components/DragSheet.jsx（応募者ページの展開ボックス）の【縦方向の処理】。
//   あちらは横スワイプの面送り（詳細⇄メイン）と同じジェスチャ判定に同居しているため実装を分けられず、
//   ここは縦だけを取り出した同じ規則の写し。動きを変えるときは必ず両方を揃えること。
//
// 【規則】①中身that最上部（scrollTop<=0）のときの下向きドラッグだけシートを掴む
//   （上向き・スクロール余地あり＝通常のスクロールに譲る）②掴んだら指に1:1で連動
//   （rAFで1フレーム1回・will-changeで自前レイヤー・掴んだ瞬間の位置を基点に置き直す＝滑らか3点セット）
//   ③離した時、引き下げたシートの上端that画面の縦中央より下なら閉じる／上なら定位置へ戻す
//   （指の座標では判定しない＝どこを掴んだかに結果that左右されないため）
//
// 使い方：
//   const sheetRef = useRef(null), scrollRef = useRef(null);
//   useSheetDragClose(sheetRef, scrollRef, () => setOpen(false), open);
//   <div ref={sheetRef} …>  <div ref={scrollRef} style={{overflowY:"auto"}}>…</div>  </div>
//   ※スクロール領域を別に持たないシートは scrollRef を省略（null）＝シート自身のscrollTopを見る
import { useEffect, useRef } from "react";

export function useSheetDragClose(sheetRef, scrollRef, onClose, open = true) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const el = sheetRef && sheetRef.current;
    if (!el) return;
    el.style.willChange = "transform";
    let sx = 0, sy = 0, baseY = 0, baseTop = 0, lastY = 0, grabbed = false, tracking = false, raf = 0;
    const paint = () => { raf = 0; el.style.transform = `translateY(${lastY}px)`; };
    const onStart = (e) => {
      if (e.touches.length !== 1) { tracking = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; grabbed = false; tracking = true;
    };
    const onMove = (e) => {
      if (!tracking) return;
      const cx = e.touches[0].clientX, cy = e.touches[0].clientY;
      const dx = cx - sx, dy = cy - sy;
      if (!grabbed) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;  // 8px動くまで判定保留
        if (Math.abs(dy) < Math.abs(dx)) { tracking = false; return; } // 横の動きは渡す
        // 下向き＆中身that最上部のときだけ掴む。スクロール領域thatなければシート自身を見る（常に0＝掴める）
        const sc = (scrollRef && scrollRef.current) || el;
        if (!(dy > 0 && sc.scrollTop <= 0)) { tracking = false; return; }
        grabbed = true; baseY = cy;
        el.style.transition = "none";
        baseTop = el.getBoundingClientRect().top; // 掴んだ瞬間の定位置（transformは0）
      }
      e.preventDefault();
      lastY = Math.max(0, cy - baseY);
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const settle = (toClose) => {
      if (toClose) {
        el.style.transition = "transform .22s ease";
        el.style.transform = "translateY(105%)";
        setTimeout(() => onCloseRef.current && onCloseRef.current(), 220);
      } else {
        el.style.transition = "transform .25s ease";
        el.style.transform = "translateY(0)";
      }
    };
    const finish = (useThreshold) => {
      if (!tracking) return;
      const wasGrabbed = grabbed;
      grabbed = false; tracking = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (wasGrabbed) settle(useThreshold && baseTop + lastY > window.innerHeight / 2);
      lastY = 0;
    };
    const onEnd = () => finish(true);
    const onCancel = () => finish(false);
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
  }, [open, sheetRef, scrollRef]);
}
