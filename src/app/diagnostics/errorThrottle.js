// エラー記録の間引き（2026-09-28）：Instagram経由の1訪問者の端末で「Script error.」（外部
// スクリプト起因）が毎秒約20件・15分間で18,200行 app_errors に書かれた教訓。記録に要るのは
// 「何が起きたか」であって、同じ行の毎秒の繰り返しではない。連発をDBに撃ち続けると、悪意が
// なくても nano インスタンスへの書き込み洪水になる（2026-09-19のダウンの型）。
// 規則＝同じ文言はページの読み込みごとに MAX_PER_MESSAGE 件まで・全部で MAX_PER_LOAD 件まで。
// 状態はメモリだけ＝リロードで最初から（リロードのループの記録は1回の読み込みにつき数行なので
// 従来どおり残る）。捨てた分は数だけ覚え、最後に書く1件の印（throttled_after）に添える。
// ★DB側にも壁がある（migration 20260928095100・同じsession 20件/分・200件/日・全体300件/分）＝
//   古いJSのタブ・API直叩きはそちらが止める。ここは「そもそも撃たない」ための前段。
export const MAX_PER_MESSAGE = 5;
export const MAX_PER_LOAD = 50;

export function makeErrorThrottle() {
  const perMessage = new Map();
  let total = 0;
  return function admit(message) {
    const key = String(message || "").slice(0, 200);
    if (total >= MAX_PER_LOAD) return { ok: false };
    const n = perMessage.get(key) || 0;
    if (n >= MAX_PER_MESSAGE) return { ok: false };
    perMessage.set(key, n + 1);
    total += 1;
    // この文言（または全体）の枠を使い切る1件＝「以後は間引く」の印を立てる
    const last = n + 1 >= MAX_PER_MESSAGE || total >= MAX_PER_LOAD;
    return { ok: true, last };
  };
}
