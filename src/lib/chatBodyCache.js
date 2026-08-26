// チャット本文の端末キャッシュ（2026-08-26 Speed-4B）。
//
// ■なぜ要るのか
// ChatViewのmsgsは必ず [] から始まり、本文はどこにも永続していなかった。そのため完全終了→再起動では
// messages の取得が終わるまで会話が1文字も出ず、実機で体感10秒待たされていた。
// 一覧の骨（相手名・求人No.・段階）は既にviewCacheで先出しできているのに、本文だけが取り残されていた。
//
// ■設計の一線（2026-08-02の安全設計をそのまま引き継ぐ）
// ・サーバーが正。ここは【表示専用】。送信権限・採用判断・契約状態・既読の正・報告対象・
//   DBへの書き込み値を、この中身から決めてはいけない
// ・本文を平文で端末に残さない＝AES-GCMで暗号化して IndexedDB に置く。鍵は extractable:false の
//   CryptoKey を IndexedDB にそのまま保管（構造化複製）＝文字列としてはどこにも出てこない
// ・復号できない・壊れている・鍵がない時は黙って捨ててネットワーク取得に戻る。平文の控えは持たない
// ・これはXSSへの完全な防御ではない（同一オリジンのスクリプトは復号を呼べる）。目的は
//   「端末のストレージに会話がそのまま読める形で残らない」こと
// ・全履歴の複製はしない：1スレッド直近30件／64KB／最大3スレッドまで
const DB_NAME = "cb_chat", DB_VER = 1;
const ST_KEY = "meta", ST_BODY = "bodies";
const KEY_ID = "aesKey";
const MAX_MSGS = 30;                 // 1スレッドで控える直近の件数
const MAX_BYTES = 64 * 1024;         // 1スレッドのJSON換算（UTF-8バイト）の上限
const MAX_THREADS = 3;               // 控えるスレッド数（古いものから消す）
// 描画に要る項目だけ（ChatViewの吹き出し・既読・求人ボックスが使う6つ）。他のDB列は控えない
const FIELDS = ["id", "application_id", "sender_id", "body", "created_at", "read_at"];

const supported = () => {
  try { return typeof indexedDB !== "undefined" && !!(globalThis.crypto && globalThis.crypto.subtle); }
  catch { return false; }
};
// いまログインしている本人（snapshotのme）。snapshot.js を import すると
// clearSnapshots→clearChatBodies で循環するので、viewCache.js と同じく直接読む
const currentUid = () => {
  try { return String((JSON.parse(localStorage.getItem("cb_snap_me") || "null") || {}).id || ""); }
  catch { return ""; }
};

const openDb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, DB_VER);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(ST_KEY)) db.createObjectStore(ST_KEY);
    if (!db.objectStoreNames.contains(ST_BODY)) db.createObjectStore(ST_BODY);
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const tx = (db, store, mode) => db.transaction(store, mode).objectStore(store);
const wrap = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

// 接続は1本を使い回す（開き直しの往復を減らす・復元は1msでも早いほうがよい）。
// ブラウザがページを閉じる時に自動で閉じるので、こちらから close はしない
let dbPromise = null;
const conn = () => (dbPromise || (dbPromise = openDb().catch(e => { dbPromise = null; throw e; })));

// 接続の下ごしらえ（2026-08-26 Speed-4B）：このモジュールは snapshot.js 経由でアプリの起動時に
// 読み込まれる。IndexedDBを開くだけ先に始めておくと、チャットを開いた時の復元が接続待ちから始まらない
//（実測：開いてから読むと本文の描画が100ms以上遅れていた）。ログインしている時だけ・失敗しても無視
try { if (supported() && currentUid()) conn(); } catch { /* 開けなければ、読み出し時にもう一度試す */ }

// 鍵：無ければ作る（書き込み時）／無ければ諦める（読み出し時）
const getKey = async (db, create) => {
  const existing = await wrap(tx(db, ST_KEY, "readonly").get(KEY_ID));
  if (existing) return existing;
  if (!create) return null;
  const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await wrap(tx(db, ST_KEY, "readwrite").put(k, KEY_ID));
  return k;
};

// 控える形に整える：送信中の仮の吹き出し(_pending)は入れない／直近30件／64KBに収まるまで古い方から落とす
export function trimForCache(list) {
  const rows = (Array.isArray(list) ? list : [])
    .filter(m => m && !m._pending && m.id)
    .map(m => { const o = {}; for (const k of FIELDS) o[k] = m[k] === undefined ? null : m[k]; return o; });
  let out = rows.slice(-MAX_MSGS);
  // 大きさは文字数でなく実バイト数で測る（日本語は1文字3バイトなので、文字数だと3倍まで通ってしまう）
  const bytes = (a) => new TextEncoder().encode(JSON.stringify(a)).length;
  while (out.length && bytes(out) > MAX_BYTES) out = out.slice(1);
  return out;
}

const recKey = (uid, appId) => uid + "|" + appId;

// 先読み（2026-08-26 Speed-4B）：チャットのURLだと分かった時点でAppが呼ぶ＝
// ChatViewが（遅れて読み込まれるチャンクなので）立ち上がるのを待たずに復号を始める。
// 結果は1回だけ引き取れる（引き取った後は、次の呼び出しで最新を読み直す）
const prefetched = new Map();
export function prefetchChatBody(appId) {
  if (!supported() || !appId || appId === "admin") return;
  const k = currentUid() + "|" + appId;
  if (!prefetched.has(k)) prefetched.set(k, readChatBodyNow(appId).catch(() => null));
}

// 前回の本文を返す（本人が一致した時だけ）。読めない・壊れている・鍵がない＝null（黙って捨てる）
export function readChatBody(appId) {
  const k = currentUid() + "|" + appId;
  if (prefetched.has(k)) { const p = prefetched.get(k); prefetched.delete(k); return p; }
  return readChatBodyNow(appId);
}

async function readChatBodyNow(appId) {
  if (!supported() || !appId) return null;
  const uid = currentUid();
  if (!uid) return null;
  let d;
  try {
    d = await conn();
    // 鍵とレコードは互いに独立なので同時に取りに行く（直列にすると往復が2回ぶん待ちになる）
    const [key, rec] = await Promise.all([getKey(d, false), wrap(tx(d, ST_BODY, "readonly").get(recKey(uid, appId)))]);
    if (!rec) return null;
    if (!key || rec.uid !== uid) { await wrap(tx(d, ST_BODY, "readwrite").delete(recKey(uid, appId))); return null; }
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.iv }, key, rec.ct);
    const arr = JSON.parse(new TextDecoder().decode(pt));
    return Array.isArray(arr) && arr.length ? arr : null;
  } catch {
    // 壊れている・復号できない＝この1件を捨てて通常のネットワーク取得に戻す
    try { if (d) await wrap(tx(d, ST_BODY, "readwrite").delete(recKey(uid, appId))); } catch { /* 消せなくても実害なし */ }
    return null;
  }
}

// サーバーから確定取得できた一覧だけを控える（_pendingは入らない＝trimForCacheが落とす）
export async function writeChatBody(appId, list) {
  if (!supported() || !appId) return;
  const uid = currentUid();
  if (!uid) return;
  let d;
  try {
    d = await conn();
    const out = trimForCache(list);
    if (!out.length) { await wrap(tx(d, ST_BODY, "readwrite").delete(recKey(uid, appId))); return; }
    const key = await getKey(d, true);
    if (!key) return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(out)));
    await wrap(tx(d, ST_BODY, "readwrite").put({ uid, appId: String(appId), iv, ct, at: Date.now() }, recKey(uid, appId)));
    // 控えるのは新しい3スレッドまで（古いものから消す）
    const store = tx(d, ST_BODY, "readwrite");
    const keys = await wrap(store.getAllKeys());
    if (keys.length > MAX_THREADS) {
      const all = await wrap(tx(d, ST_BODY, "readonly").getAll());
      const pairs = keys.map((k, i) => ({ k, at: (all[i] && all[i].at) || 0 })).sort((a, b) => b.at - a.at);
      const del = tx(d, ST_BODY, "readwrite");
      pairs.slice(MAX_THREADS).forEach(p => del.delete(p.k));
    }
  } catch { /* 控えられなくても表示には影響しない（サーバーが正） */ }
}

// ログアウト等（clearSnapshots）で呼ぶ：本文も鍵も全部消す＝別の人が前の人の会話を復元できない
export async function clearChatBodies() {
  if (!supported()) return;
  try {
    const d = await conn();
    await Promise.all([wrap(tx(d, ST_BODY, "readwrite").clear()), wrap(tx(d, ST_KEY, "readwrite").clear())]);
  } catch { /* 消せなくても、読み出し側が本人照合と復号失敗で弾く */ }
}
