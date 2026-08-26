// 右スワイプで前の画面へ戻る（LINEと同じ手触り・2026-08-24たきと指示
// 「LINEと同じ横スワイプでチャットページに遷移」＝チャットのスレッドから一覧へ戻る）。
//
// 規則は他の指連動と同じ作法（DragSheet・hDrag・sheetDrag）：
//   ①8px動くまで軸を決めない ②1ジェスチャで軸は1回だけ確定（縦と決まったら以後ノータッチ
//     ＝メッセージの縦スクロールに完全に譲る）③右向きだけ掴む（左向きは何もしない＝行き先が無い）
//   ④掴んだら指に1:1で追従（rAFで1フレーム1回・will-change・transitionはnone）
//   ⑤離した時、引いた幅が画面の25%か80pxを超えていれば戻る／届かなければ元の位置へ滑らせて戻す
//
// ★掴まない場所（誤操作を作らない）：
//   ・画面の左端24px＝ブラウザ自身の「戻る」の場所so譲る（両方が動くと二重に戻る）
//   ・被せ（.cb-lock-scroll＝ボックス・シート）の中で始まったタッチ
//   ・入力欄（input/textarea）の中＝文字の選択・カーソル移動を奪わない
//   ・横に送れる要素（写真の列など overflow-x があって実際にはみ出している祖先）の中
import { useEffect, useRef } from "react";

const EDGE_SKIP = 24;      // 画面の左端はブラウザの戻るに譲る
const AXIS_LOCK = 8;       // 方向が決まるまでの遊び
const OUT_MS = 180;        // 戻る時に画面が右へ抜ける時間

export function useSwipeBack(rootRef, onBack, enabled = true) {
  const backRef = useRef(onBack);
  backRef.current = onBack;
  useEffect(() => {
    if (!enabled) return;
    const el = rootRef && rootRef.current;
    if (!el) return;
    const view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    let sx = 0, sy = 0, dx = 0, lock = null, tracking = false, raf = 0;
    const paint = () => { raf = 0; el.style.transform = dx ? `translateX(${dx}px)` : ""; };
    // 横に送れる祖先（写真の列・タブの帯など）の中では掴まない＝そちらの操作を邪魔しない
    const inHScroll = (node) => {
      for (let n = node; n && n !== el; n = n.parentElement) {
        const ov = view.getComputedStyle(n).overflowX;
        if ((ov === "auto" || ov === "scroll") && n.scrollWidth > n.clientWidth + 1) return true;
      }
      return false;
    };
    const onStart = (e) => {
      tracking = false;
      if (!e.touches || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX < EDGE_SKIP) return;
      const tgt = e.target;
      if (tgt && tgt.closest && tgt.closest(".cb-lock-scroll, input, textarea")) return;
      if (tgt && inHScroll(tgt)) return;
      sx = t.clientX; sy = t.clientY; dx = 0; lock = null; tracking = true;
      el.style.transition = "none";
      el.style.willChange = "transform";
    };
    const onMove = (e) => {
      if (!tracking || !e.touches || !e.touches[0]) return;
      const cx = e.touches[0].clientX, cy = e.touches[0].clientY;
      const mx = cx - sx, my = cy - sy;
      if (!lock) {
        if (Math.abs(mx) < AXIS_LOCK && Math.abs(my) < AXIS_LOCK) return;
        if (Math.abs(my) >= Math.abs(mx) || mx <= 0) { tracking = false; return; } // 縦・左向きは譲る
        lock = "h";
      }
      if (e.cancelable) e.preventDefault();
      dx = Math.max(0, mx);
      if (!raf) raf = view.requestAnimationFrame(paint);
    };
    const finish = (useThreshold) => {
      if (!tracking) return;
      const grabbed = lock === "h";
      tracking = false; lock = null;
      if (raf) { view.cancelAnimationFrame(raf); raf = 0; }
      if (!grabbed) { dx = 0; el.style.transform = ""; return; }
      const w = el.clientWidth || view.innerWidth || 360;
      const go = useThreshold && dx >= Math.min(80, w * 0.25);
      dx = 0;
      if (go) {
        el.style.transition = `transform ${OUT_MS}ms ease`;
        el.style.transform = "translateX(100%)";
        setTimeout(() => { if (backRef.current) backRef.current(); }, OUT_MS);
      } else {
        el.style.transition = "transform .22s cubic-bezier(.22,.8,.36,1)";
        el.style.transform = "";
      }
    };
    const onEnd = () => finish(true);
    const onCancel = () => finish(false);
    // ReactのonTouchMoveはルートでpassive登録されpreventDefaultが効かないため、ネイティブ{passive:false}
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      if (raf) view.cancelAnimationFrame(raf);
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
      el.style.transform = ""; el.style.transition = ""; el.style.willChange = "";
    };
  }, [enabled, rootRef]);
}
