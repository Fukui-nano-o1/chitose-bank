// 横スワイプ（指連動＋慣性）：横スクロールできる要素を指の動きで送り、
// 離した時の勢いで減衰しながら流す（2026-08-19新設・2026-08-29慣性を追加＝たきと指示
// 「勢いよくスワイプしたなら勢いを。慣性の法則みたいなのがあればストレスがない」）。
//
// ★なぜJSで書くのか（ブラウザ任せにできない理由）：
//   求人詳細のタブ切替（ContentQSwipeArea）や あなたの求人のページャーのルートは
//   touch-action:"pan-y" ので、その中に置いた overflow-x:auto の要素は
//   【ブラウザの横スクロールが丸ごと止まる】（touch-action は要素と祖先の積で決まる
//   ＝子で pan-x を宣言しても復活しない）。ので「指で横に動かす」も「離した後の慣性」も
//   touchmove / rAF で scrollLeft を書いて自前で作る。
//
// ★タブ切替との取り合いは起きない：ContentQSwipeArea 側は inHScroll
//   （overflow-x があり実際にはみ出している祖先）を見つけると掴むのをやめる＝譲る。
//
// 規則（DragSheet・ContentQSwipeArea と同じ作法に揃える）：
//   ①8px動くまで軸を決めない ②1ジェスチャで軸は1回だけ確定（縦と決まったら以後ノータッチ
//   ＝ページの縦スクロールに完全に譲る）③横と決まったら preventDefault して scrollLeft を書く
//   ④はみ出していない（1画面に収まっている）ときは掴まない＝親のタブ切替を邪魔しない
//
// 慣性の規則：
//   ・触れている間は指に1:1（ここは変えない＝つまんで戻す操作が効くように）
//   ・離した瞬間、直近100msの動きから速度を出す。速ければそのまま流し、毎msごとに
//     減衰（DECAY^dt）＝iOSのネイティブスクロールと同じ指の感触に寄せた指数減衰
//   ・指で止めてから離した（最後の動きが古い）ときは流さない＝置いた場所で止まる
//   ・次のタッチで即停止＝流れている列は指で受け止められる
//   ・端に着いたら止まる（scrollLeft はブラウザが自動でクランプする）
import { useEffect } from "react";

const DECAY = 0.998;    // 1msあたりの減衰率（0.998^dt・iOSの標準的な減速感）
const MIN_FLING = 0.25; // これ未満の速度(px/ms)で離したら流さない＝ゆっくり置いた扱い
const MAX_V = 5;        // 速度の上限(px/ms)＝異常な計測値で吹っ飛ばない
const STOP_V = 0.02;    // これ未満(px/ms)まで減速したら停止
const STALE_MS = 100;   // 最後の動きからこれ以上たって離したら「止めてから離した」＝流さない

export function useHorizontalDrag(ref, dep) {
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let g = null;        // { x, y, left, lock:'h'|'v'|null, samples:[{t,left}] }
    let momentum = null; // 慣性中の rAF id
    const stopMomentum = () => { if (momentum) { cancelAnimationFrame(momentum); momentum = null; } };
    const onStart = ev => {
      stopMomentum(); // 流れている最中のタッチ＝指で受け止める
      if (el.scrollWidth <= el.clientWidth + 1) { g = null; return; } // はみ出していない＝掴まない
      const t = ev.touches && ev.touches[0]; if (!t) return;
      g = { x: t.clientX, y: t.clientY, left: el.scrollLeft, lock: null, samples: [] };
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
      // 速度の見本：直近100msぶんだけ持つ（それより古い動きは今の勢いではない）
      const now = ev.timeStamp || performance.now();
      g.samples.push({ t: now, left: el.scrollLeft });
      while (g.samples.length > 2 && now - g.samples[0].t > STALE_MS) g.samples.shift();
    };
    const onEnd = ev => {
      const gg = g; g = null;
      if (!gg || gg.lock !== "h" || gg.samples.length < 2) return;
      const now = (ev && ev.timeStamp) || performance.now();
      const first = gg.samples[0], last = gg.samples[gg.samples.length - 1];
      if (now - last.t > STALE_MS) return; // 指で止めてから離した＝勢いなし
      const span = last.t - first.t; if (span <= 0) return;
      let v = (last.left - first.left) / span; // scrollLeft の速度 px/ms
      if (Math.abs(v) < MIN_FLING) return;
      v = Math.max(-MAX_V, Math.min(MAX_V, v));
      let prev = performance.now();
      const step = () => {
        momentum = null;
        const t2 = performance.now();
        const d = Math.min(t2 - prev, 64); // タブ切替等でフレームが飛んでも一気に跳ばない
        prev = t2;
        el.scrollLeft += v * d;            // 範囲外はブラウザがクランプする
        v *= Math.pow(DECAY, d);
        const max = el.scrollWidth - el.clientWidth;
        if (Math.abs(v) < STOP_V || el.scrollLeft <= 0 || el.scrollLeft >= max - 0.5) return; // 減速か端で終わり
        momentum = requestAnimationFrame(step);
      };
      momentum = requestAnimationFrame(step);
    };
    const onCancel = () => { g = null; }; // 中断（着信・システムジェスチャ等）は流さない
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      stopMomentum();
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, [ref, dep]);
}
