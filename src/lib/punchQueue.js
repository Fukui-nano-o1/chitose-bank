// 圏外の打刻キュー（第13弾(3)・2026-07-30たきと指示「畑は電波が弱く、握手が押せない事態が必ず起きる」）
//
// 握手のタップで通信に失敗したら、押した時刻を端末に貯めておき、電波が戻ったら自動で送る。
// ★送るのは「押した時刻」であって復帰した時刻ではない（punch_start の p_at で渡す）。
//   申告時刻はサーバ側でクランプされる（未来不可・24時間以内・作業日0:00 JST以降）。
//
// 保存先は localStorage。IndexedDB でなく localStorage にしたのは、貯めるのが
// 「応募IDと時刻」だけ＝数十バイト×数件で、同期APIの単純さが勝るため。
// 個人情報は入らない（応募のUUIDと時刻のみ。名前も本文も持たない）。
const KEY = "cb_punchQueue";

const read = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};
const write = (arr) => {
  try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch { /* 容量超過等は諦める */ }
};

// 通信に失敗した打刻を積む。同じ応募が二重に積まれないよう、先勝ち（最初に押した時刻を残す）
export function enqueuePunch(applicationId, atISO) {
  if (!applicationId) return;
  const q = read();
  if (q.some(x => x.application_id === applicationId)) return;
  q.push({ application_id: applicationId, at: atISO || new Date().toISOString() });
  write(q);
}
export function queuedPunches() { return read(); }
export function isQueued(applicationId) { return read().some(x => x.application_id === applicationId); }
export function removePunch(applicationId) {
  write(read().filter(x => x.application_id !== applicationId));
}

// 溜まっているぶんを送る。send(applicationId, atISO) は成功時に真を返す関数を渡す。
// 送信できたものだけキューから消す（失敗ぶんは次の機会に持ち越し＝取りこぼさない）。
// 戻り値：実際に送信できた件数（呼び出し側が「送信しました」を1回だけ出すのに使う）
export async function flushPunchQueue(send) {
  const q = read();
  if (q.length === 0) return 0;
  let sent = 0;
  for (const item of q) {
    try {
      const ok = await send(item.application_id, item.at);
      if (ok) { removePunch(item.application_id); sent++; }
    } catch { /* 次の機会に持ち越す */ }
  }
  return sent;
}
