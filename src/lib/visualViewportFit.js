// 画面が拡大されている時、全画面の被せ（position:fixed）を「見えている画面」に合わせる（2026-09-04）
//
// なぜ要るか：position:fixed は【レイアウトの画面】（＝拡大しても390ptのまま）を基準に置かれる。
// 利用者が二度叩き・二本指で1.3倍に拡大すると、被せの中身も1.3倍で描かれるので
// 390pt幅のパネルが507pt相当になり、右端が画面の外へ出る（＝2026-09-04にたきとが報告した
// 「仕事をさがすが画面に収まっていない」の実体。実ブラウザで1.3倍を再現して一致を確認した）。
// パネル側の幅指定（maxWidth 520・左右16px）は正しく、いくら幅を絞っても直らない類の症状。
//
// 対処：visualViewport（＝いま見えている範囲）の大きさと位置を読み、被せをそこへ合わせる。
// 拡大していない時は何も書かない＝従来の inset:0 のままで、見た目も挙動も一切変わらない。
//
// ★transform を使うので、被せの【中】に position:fixed の子を置かないこと
//   （transform は fixed の基準を作り替える・2026-07-14の既知の罠）。
// ★新しい全画面の被せを作る時にも使える。ref を渡すだけ。
import { useEffect } from "react";

// 拡大していない＝倍率が1でズレも無い状態か（浮動小数の誤差を見込んで判定）
function isPlain(vv) {
  return Math.abs(vv.scale - 1) < 0.01 && Math.abs(vv.offsetLeft) < 0.5 && Math.abs(vv.offsetTop) < 0.5;
}

export function useVisualViewportFit(ref, active) {
  useEffect(() => {
    if (!active) return;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return; // 非対応のブラウザは従来どおり（何もしない＝壊さない）
    let raf = 0;
    const clear = () => {
      const el = ref.current;
      if (!el) return;
      el.style.width = ""; el.style.height = ""; el.style.transform = "";
    };
    const apply = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      if (isPlain(vv)) { clear(); return; }
      // 見えている範囲の大きさに縮め、その左上へ寄せる＝拡大されていても画面内に収まる
      el.style.width = vv.width + "px";
      el.style.height = vv.height + "px";
      el.style.transform = `translate(${vv.offsetLeft}px, ${vv.offsetTop}px)`;
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(apply); }; // 1フレーム1回だけ書く
    apply();
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv.removeEventListener("resize", on);
      vv.removeEventListener("scroll", on);
      clear();
    };
  }, [ref, active]);
}
