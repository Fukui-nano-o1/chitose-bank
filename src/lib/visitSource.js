// 流入元(src)と匿名キー(anon_key)の唯一の置き場（2026-08-22たきと指示）。
// 用途は page_events（閲覧計測）だけ。権限判定・書き込みの「正」には使わない
// （viewCache/snapshotと同じ規則＝端末内で書き換えられても計測が乱れるだけ）。
//
// ・src … 初回ロードで location.search の ?src=（例: chitose-bank.com/?src=insta）を
//   localStorage に保存。以後のページ遷移でも同じ値を計測に添える。
//   ★ハッシュルーティングなので ?src= は【#より前】に置くこと（#/visit?src=… は拾わない）。
//   新しい src 付きで再訪したら上書き（最後に踏んだ流入元を正とする）。
// ・anon_key … 未ログイン端末の匿名UUID。localStorage に永続。auth.users とは無関係で、
//   本人特定には使えない乱数（DB側もRLSで auth_id=null を強制＝なりすまし不可）。
// ・localStorage が使えない環境（プライベートモード等）は null を返し、呼び出し側が記録を諦める。

const SRC_KEY = "cb_src";
const ANON_KEY = "cb_anonKey";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ?src= を読んで保存し、いま有効な流入元を返す（無ければ保存済みの値）。冪等。
export function getTrafficSrc() {
  try {
    const p = new URLSearchParams(window.location.search).get("src");
    if (p) {
      const v = String(p).slice(0, 64); // DB側のRLS上限と同じ64字
      localStorage.setItem(SRC_KEY, v);
      return v;
    }
    return localStorage.getItem(SRC_KEY) || null;
  } catch { return null; }
}

// 未ログイン端末の匿名キー。無ければ生成して保存。保存できない環境は null。
export function getAnonKey() {
  try {
    const k = localStorage.getItem(ANON_KEY);
    if (k && UUID_RE.test(k)) return k;
    const nk = genUuid();
    if (!nk) return null;
    localStorage.setItem(ANON_KEY, nk);
    return nk;
  } catch { return null; }
}

function genUuid() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    // 古いSafari(<15.4)向け：getRandomValuesからUUIDv4を組む
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  } catch { return null; }
}
