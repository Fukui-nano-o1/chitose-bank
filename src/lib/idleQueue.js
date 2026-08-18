// 起動時に要らない問い合わせを後ろへ送るための最小の待ち行列（2026-08-18 Speed-1C-1）。
//
// ■なぜ要るのか（Speed-0の実測）
// アプリを開くと1秒のうちにRESTを25本まとめて撃っており、冷えた回は全部が10〜14秒になっていた。
// DBの実行は数百msso、待っているのは行列そのもの。初期画面の成立に要らないものを後ろへ送れば、
// 同時に突撃する本数が減る。
//
// ■「500ms後にまとめて全部」にはしない（たきと指示）
// それでは25本が少し後ろへずれて集団で突撃するだけ。ここは【1本ずつ】流す：
//   1本実行 → 終わるのを待つ → 次のidleを予約 → 次の1本
// 同じidle枠に2本を登録しない。
//
// ■責務はこれだけ（増やさない）
//   requestIdleCallback があれば使う／無ければ setTimeout で代替／1本ずつ実行／cancelで未実行分を捨てる
// キャッシュ・状態管理・通信の抽象化は持たせない。
const schedule = (fn) => {
  if (typeof requestIdleCallback === "function") {
    // timeout＝暇にならなくても最後は必ず動かす（iOSは条件次第でidleが来にくい）
    return { kind: "idle", id: requestIdleCallback(fn, { timeout: 2000 }) };
  }
  return { kind: "timer", id: setTimeout(fn, 300) };
};
const unschedule = (h) => {
  if (!h) return;
  if (h.kind === "idle" && typeof cancelIdleCallback === "function") cancelIdleCallback(h.id);
  else if (h.kind === "timer") clearTimeout(h.id);
};

export function createIdleQueue() {
  const tasks = [];
  let handle = null;
  let running = false;
  let cancelled = false;

  const pump = () => {
    handle = null;
    if (cancelled || running) return;
    const task = tasks.shift();
    if (!task) return;
    running = true;
    // 例外でも止まらない。1本終わってから次のidleを予約する
    Promise.resolve()
      .then(task)
      .catch(() => {})
      .then(() => {
        running = false;
        if (!cancelled && tasks.length) handle = schedule(pump);
      });
  };

  return {
    push(task) {
      if (cancelled) return;
      tasks.push(task);
      if (!handle && !running) handle = schedule(pump);
    },
    // 画面が消えた時に呼ぶ＝未実行のぶんは捨てる（閉じた画面のために通信しない・2026-08-18 Speed-1Bの原則）
    cancel() {
      cancelled = true;
      tasks.length = 0;
      unschedule(handle);
      handle = null;
    },
  };
}
