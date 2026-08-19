// 横スワイプ（指連動）：横スクロールできる要素を、指の動きに1:1で追従させる（2026-08-19）。
//
// ★なぜJSで書くのか（ブラウザ任せにできない理由）：
//   求人詳細のタブ切替（ContentQSwipeArea）のルートは touch-action:"pan-y" ので、
//   その中に置いた overflow-x:auto の要素は【ブラウザの横スクロールが丸ごと止まる】
//   （touch-action は要素と祖先の積で決まる＝子で pan-x を宣言しても復活しない）。
//   ので「指で横に動かす」は touchmove で scrollLeft を書いて自前で作る。
//
// ★タブ切替との取り合いは起きない：ContentQSwipeArea 側は inHScroll
//   （overflow-x があり実際にはみ出している祖先）を見つけると掴むのをやめる＝譲る。
//
// 規則（DragSheet・ContentQSwipeArea と同じ作法に揃える）：
//   ①8px動くまで軸を決めない ②1ジェスチャで軸は1回だけ確定（縦と決まったら以後ノータッチ
//   ＝ページの縦スクロールに完全に譲る）③横と決まったら preventDefault して scrollLeft を書く
//   ④はみ出していない（1画面に収まっている）ときは掴まない＝親のタブ切替を邪魔しない
import { useEffect } from "react";

export function useHorizontalDrag(ref, dep) {
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let g = null; // { x, y, left, lock:'h'|'v'|null }
    const onStart = ev => {
      if (el.scrollWidth <= el.clientWidth + 1) { g = null; return; } // はみ出していない＝掴まない
      const t = ev.touches && ev.touches[0]; if (!t) return;
      g = { x: t.clientX, y: t.clientY, left: el.scrollLeft, lock: null };
    };
    const onMove = ev => {
      if (!g) return;
      const t = ev.touches && ev.touches[0]; if (!t) return;
      const dx = t.clientX - g.x, dy = t.clientY - g.y;
      if (!g.lock) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // 8px動くまで判定保留
        g.lock = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      }
      if (g.lock !== "h") return; // 縦確定＝ページのスクロールに譲る
      if (ev.cancelable) ev.preventDefault();
      el.scrollLeft = g.left - dx; // 指に1:1で追従
    };
    const onEnd = () => { g = null; };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref, dep]);
}
