// 郵便番号→住所の検索（2026-08-02・委託ページの圃場登録で「検索に数十秒」対策）。
//
// 【原因】従来は zipcloud（無料・SLAなしの単一API）に1本依存で、タイムアウトも代替も無かった。
// zipcloud側が混雑で遅い時、その遅さがそのまま画面の待ち時間になる（数十秒はzipcloudの応答待ち）。
// 【対策】2系統へ同時に問い合わせ、先に住所を返した方を採用（レース）：
//   ① madefor postal-code-api（GitHub Pages上の静的JSON＝CDN配信で通常数百ms・日本郵便データ由来）
//   ② zipcloud（従来のAPI）
// さらに各系統にタイムアウト、結果は端末キャッシュ（同じ郵便番号の2回目は0ms）。
// どちらかが生きていれば1秒前後で返る。両方落ちている時だけエラー。
const CACHE_KEY = "cb_zipCache_v1";

const readCache = () => {
  try { const o = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch { return {}; }
};
const writeCache = (zip, val) => {
  try {
    const o = readCache();
    o[zip] = val;
    const keys = Object.keys(o);
    if (keys.length > 300) delete o[keys[0]]; // 肥大防止（古い順に1つ落とす）
    localStorage.setItem(CACHE_KEY, JSON.stringify(o));
  } catch {}
};

const withTimeout = (ms) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
};

// zipcloud：address1=都道府県 / address2=市区町村 / address3=町域
async function fromZipcloud(zip, ms) {
  const t = withTimeout(ms);
  try {
    const res = await fetch("https://zipcloud.ibsnet.co.jp/api/search?zipcode=" + zip, { signal: t.signal });
    const j = await res.json();
    const r = j && j.results && j.results[0];
    if (!r) throw new Error("notfound");
    return { prefecture: r.address1 || "", city: r.address2 || "", town: r.address3 || "" };
  } finally { t.done(); }
}

// madefor：ja.prefecture=都道府県 / ja.address1=市区町村 / ja.address2以降=町域
async function fromMadefor(zip, ms) {
  const t = withTimeout(ms);
  try {
    const res = await fetch(`https://madefor.github.io/postal-code-api/api/v1/${zip.slice(0, 3)}/${zip.slice(3)}.json`, { signal: t.signal });
    if (!res.ok) throw new Error(res.status === 404 ? "notfound" : "http");
    const j = await res.json();
    const r = j && j.data && j.data[0] && j.data[0].ja;
    if (!r) throw new Error("notfound");
    return { prefecture: r.prefecture || "", city: r.address1 || "", town: (r.address2 || "") + (r.address3 || "") + (r.address4 || "") };
  } finally { t.done(); }
}

// 返り値：{ ok:true, prefecture, city, town, full } ／ { ok:false, reason: "format"|"notfound"|"network" }
export async function zipLookup(zipInput) {
  const zip = String(zipInput || "").replace(/[^0-9]/g, "");
  if (zip.length !== 7) return { ok: false, reason: "format" };
  const cached = readCache()[zip];
  if (cached) return { ok: true, ...cached, full: (cached.prefecture || "") + (cached.city || "") + (cached.town || "") };
  const sources = [fromMadefor(zip, 4000), fromZipcloud(zip, 6000)];
  let notfound = false;
  let pending = sources.length;
  const result = await new Promise((resolve) => {
    sources.forEach(p => p.then(
      v => resolve(v), // 先に住所を返した方を採用（2回目以降のresolveは無視される）
      e => { if (String(e && e.message) === "notfound") notfound = true; if (--pending === 0) resolve(null); }
    ));
  });
  if (!result) return { ok: false, reason: notfound ? "notfound" : "network" };
  writeCache(zip, result);
  return { ok: true, ...result, full: (result.prefecture || "") + (result.city || "") + (result.town || "") };
}
