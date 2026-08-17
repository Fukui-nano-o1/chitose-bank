// さがす（求人検索）の指紋を採る（Phase 4 の 4-0・2026-08-17）。
//
// 目的：検索は「表示が壊れる」のではなく【表示は正常なまま結果だけ静かに変わる】型の事故が起きる。
// build も lint も通ってしまうため、分割の前に「何を取り、何を除き、どう並べ、誰に何を見せるか」を
// 機械で採取して固定し、各コミットで採り直して差分を見る。
//
// 使い方：
//   node scripts/search-fingerprint.mjs            指紋を出力（採取）
//   node scripts/search-fingerprint.mjs --check    baseline と比較（差分があれば exit 1）
//   node scripts/search-fingerprint.mjs --write    baseline を更新（意図した変更のときだけ）
//
// ★これは静的解析＝ソースから読み取れる不変条件だけを見る。実行時の件数（何件返るか）は
//   scripts/search-fingerprint.baseline.txt の末尾に、採取時点のDB実測値を注記として貼ってある。
import fs from "node:fs";
import path from "node:path";

// 検索の意味論を持つファイル。分割で移動したらここを直す（＝移動そのものは差分に出さない）
const FILES = [
  "src/components/JobSearchMapView.jsx",
  "src/lib/searchJobs.js",
  "src/components/JobCard.jsx",
  "src/components/JobLocationMap.jsx",
  "src/components/SearchLaneTabs.jsx",
  "src/components/ConsignmentSearchList.jsx",
  "src/lib/consignAccess.js",
  "src/lib/utils.js",            // mapJobPublicRow の派生フラグ（closed/filled/expired/isNew）だけを見る
  "src/features/jobs/search/JobSearchMapView.jsx",
  "src/features/jobs/search/model.js",
  "src/features/jobs/search/map/JobSearchMap.jsx",
  "src/features/jobs/search/filters/SearchFilterPanel.jsx",
  "src/features/jobs/search/components/JobDetailPanel.jsx",
  "src/features/jobs/search/components/ApplyPanel.jsx",
  "src/features/jobs/search/searchJobs.js",
  "src/features/jobs/search/jobSearchApi.js",
];

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);
const flat = (s) => s.replace(/\s+/g, " ");

// 行をまたぐ呼び出しを1本につなぐ。
// ★2026-08-18修正：以前は「括弧の釣り合い」で切っていたため、
//     supabase.from("x")        ← ここで括弧が閉じる
//       .select("...")          ← 拾えない
//       .eq("auth_id", uid)     ← 拾えない
//   という連鎖を1行目だけで打ち切り、select列と絞り込みを取りこぼしていた（検出器の穴）。
//   文の終端（深さ0の ; または行末が , で深さ0）まで読むように直した。
function joinCalls(src, needle) {
  const lines = src.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(needle)) continue;
    let c = lines[i].trim(), j = i;
    const depth = (t) => (t.split("(").length - t.split(")").length)
                       + (t.split("[").length - t.split("]").length)
                       + (t.split("{").length - t.split("}").length);
    // 深さが残る／次行がメソッド連鎖（.xxx で始まる）なら続きを読む
    while (j + 1 < lines.length) {
      const nxt = lines[j + 1].trim();
      const open = depth(c) > 0;
      const chained = /^\./.test(nxt);
      const unterminated = !/[;,]$/.test(c) && !open;
      if (!open && !chained && !unterminated) break;
      c += " " + nxt; j++;
      if (depth(c) <= 0 && /;$/.test(c)) break;
    }
    out.push(flat(c));
    i = j;
  }
  return out;
}

const bag = (arr) => {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, n]) => `${k}  x${n}`);
};

function collect() {
  const sec = {};
  const add = (k, v) => (sec[k] = (sec[k] || []).concat(v));

  for (const f of FILES) {
    let src = read(f);
    if (src == null) continue;
    // utils.js は巨大な共有層。検索に効くのは mapJobPublicRow だけので、そこだけを見る
    // （検索と無関係な変更を「検索の差分」として誤検出しないため）
    if (f.endsWith("lib/utils.js")) {
      const m = src.match(/export function mapJobPublicRow[\s\S]*?\n\}\n/);
      if (!m) { console.error("★mapJobPublicRow が見つかりません:", f); process.exit(2); }
      src = m[0];
    }

    // ① データ取得：表・RPC・列・絞り込み・メソッド
    for (const c of joinCalls(src, "supabase.")) {
      for (const m of c.matchAll(/\.from\(\s*["'`]([\w.]+)["'`]\s*\)/g)) add("data:table", `from:${m[1]}`);
      for (const m of c.matchAll(/\.rpc\(\s*["'`](\w+)["'`]/g)) add("data:rpc", `rpc:${m[1]}`);
      for (const m of c.matchAll(/\.select\(\s*["'`]([^"'`]*)["'`]/g)) add("data:select", `select:${m[1]}`);
      for (const m of c.matchAll(/\.(eq|neq|in|gt|gte|lt|lte|is|not)\(\s*["'`](\w+)["'`]/g)) add("data:filter", `${m[1]}:${m[2]}`);
      for (const m of c.matchAll(/\.order\(\s*["'`](\w+)["'`][^)]*ascending:\s*(\w+)/g)) add("data:order", `order:${m[1]}:asc=${m[2]}`);
      for (const m of c.matchAll(/\.(insert|update|upsert|delete|maybeSingle|single|getSession)\(/g)) add("data:method", `${m[1]}`);
      for (const m of c.matchAll(/p_(\w+)\s*:/g)) add("data:rpcArg", `p_${m[1]}`);

      // 問い合わせ1本ごとの【組合せ】（2026-08-18・4-A2.1で追加）。
      // data:* は「どの操作が存在するか」しか見ないため、条件を別の問い合わせに付け間違えても
      // 全体集合が同じなら見逃せてしまう。ここは1本の中の 表・列・絞り込み・メソッド を
      // 束ねて1つの形として持つ＝付け替えを検出する。窓口へ集約しても形は変わらないので壊れない。
      const parts = [];
      for (const m of c.matchAll(/\.from\(\s*["'`]([\w.]+)["'`]\s*\)/g)) parts.push(`from:${m[1]}`);
      for (const m of c.matchAll(/\.rpc\(\s*["'`](\w+)["'`]/g)) parts.push(`rpc:${m[1]}`);
      const sub = [];
      for (const m of c.matchAll(/\.select\(\s*["'`]([^"'`]*)["'`]/g)) sub.push(`select:${m[1]}`);
      for (const m of c.matchAll(/\.(eq|neq|in|gt|gte|lt|lte|is|not)\(\s*["'`](\w+)["'`]/g)) sub.push(`${m[1]}:${m[2]}`);
      for (const m of c.matchAll(/\.order\(\s*["'`](\w+)["'`][^)]*ascending:\s*(\w+)/g)) sub.push(`order:${m[1]}:asc=${m[2]}`);
      for (const m of c.matchAll(/\.(insert|update|upsert|delete|maybeSingle|single)\(/g)) sub.push(m[1]);
      for (const m of c.matchAll(/p_(\w+)\s*:/g)) sub.push(`p_${m[1]}`);
      // 並べ替えは意味を変えない（.eq の順序は結果に影響しない）ので整列して比較する
      if (parts.length) add("data:queryShape", [...parts, ...sub.sort()].join(" | "));
    }

    // ② 除外・終了判定・並び
    for (const m of src.matchAll(/isEndedJob\s*=\s*\((\w+)\)\s*=>\s*([^;]+);/g)) add("rule:ended", flat(m[2]));
    // 終了判定の実体＝mapJobPublicRow が付ける派生フラグ。ここが変わると除外の意味が変わる
    for (const m of src.matchAll(/^\s{4}(closed|filled|isNew):\s*([^\n]+?),\s*$/gm)) add("rule:jobFlag", `${m[1]}: ${flat(m[2])}`);
    const exp = src.match(/^\s{4}expired:\s*\(\(\) => \{[\s\S]*?\n\s{4}\}\)\(\),/m);
    if (exp) add("rule:jobFlag", "expired: " + flat(exp[0]).slice(0, 220));
    // 比較関数つきの sort だけを拾う（引数なしの .sort() は文字列整列＝並び規則ではないので除く）
    for (const m of src.matchAll(/\.sort\(\s*\((\w+),\s*(\w+)\)\s*=>\s*([^;\n]*?)\)(?=[;,.\s)])/g))
      add("rule:sort", flat(`(${m[1]}, ${m[2]}) => ${m[3]}`).slice(0, 120));
    for (const m of src.matchAll(/status\s*[!=]==?\s*["'`](\w+)["'`]/g)) add("rule:statusCompare", m[1]);

    // ③ 一覧の絞り込み述語（filteredList の本体）
    const fl = src.match(/const filteredList = [\s\S]*?\n  \}\);/);
    if (fl) for (const l of fl[0].split("\n").map((x) => x.trim()).filter(Boolean)) add("rule:filterPredicate", l);

    // ④ いいね（保存済み判定）
    // いいねは生テキストでなく操作の形で見る（me.id → workerId のような引数名の変更で鳴らせない。
    // 表・メソッド・絞り込みは data:* が押さえているので、ここは画面側の判定だけを見る）
    for (const m of src.matchAll(/savedIds\.(has|add|delete)\(/g)) add("rule:saved", `savedIds.${m[1]}`);

    // ⑤ 地図（Leaflet）：生成する要素の種類と回数
    for (const m of src.matchAll(/\bL\.(\w+)\(/g)) add("map:leaflet", `L.${m[1]}`);
    for (const m of src.matchAll(/\.addTo\(map\)/g)) add("map:addTo", "addTo(map)");
    for (const m of src.matchAll(/(fitBounds|setView)\(/g)) add("map:view", m[1]);

    // ⑤b 地図の寿命と幾何（2026-08-18・4-A3で追加）
    // 地図はDBと別種の危険がある：見た目が同じでも、effectの依存・破棄順・座標欠損の扱いが
    // 変わると壊れる（2026-07-16の _leaflet_pos 真っ暗事故がその型）。
    // ここは「何が描かれるか」ではなく【いつ作られ・いつ壊され・どこを中心に・どこまで描くか】を見る。
    // ★アンカーが見つからなければ黙って素通りせず止める（4-A2の取りこぼしを繰り返さない）。
    if (/JobLocationMap\.jsx$/.test(f)) {
      const need = (re, key, label) => {
        const m = src.match(re);
        if (!m) { console.error(`★地図の不変条件が見つかりません（${label}）:`, f); process.exit(2); }
        add(key, flat(m[1] !== undefined ? m[1] : m[0]).slice(0, 200));
      };
      // 生成・破棄のタイミング＝全 useEffect の依存配列（地図の再生成条件そのもの）
      for (const m of src.matchAll(/\n\s*\}, (\[[^\]]*\])\);/g)) add("map:effectDeps", flat(m[1]));
      // 破棄（remove）と、作り直す前の後始末。片方でも消えると地図が二重に生きる
      for (const m of src.matchAll(/(mapRef\.current(?:\?)?\.remove\(\))/g)) add("map:cleanup", m[1]);
      for (const m of src.matchAll(/mapRef\.current = (null|map)\b/g)) add("map:cleanup", `mapRef.current = ${m[1]}`);
      // 座標が欠けている求人を地図化するか（＝ピンを立ててよいかの判定）
      need(/if \(lat == null \|\| lng == null \|\| [^\n]*\) return;/, "map:guard", "座標欠損の門番");
      need(/if \(lat == null \|\| lng == null\) \{/, "map:guard", "座標欠損時の代替表示");
      need(/if \(visitor && !cityGeo && !cityGeoTried\) return;/, "map:guard", "訪問者の中心が取れるまで描かない");
      // 円と中心の扱い（訪問者に見せる範囲＝マスクの一部。小さくすると場所が絞られる）
      need(/const VISITOR_CIRCLE_M = (\d+);/, "map:geometry", "訪問者の円の半径");
      need(/const center = ([^\n;]+);/, "map:geometry", "中心の決め方");
      need(/const r = ([^\n;]+);/, "map:geometry", "半径の既定値");
      need(/const fitM = ([^\n;]+);/, "map:geometry", "表示範囲の広さ");
      need(/map\.setView\(([^\n;]+)\);/, "map:geometry", "setViewの引数");
      need(/map\.fitBounds\(([^\n]+)\);/, "map:geometry", "fitBoundsの引数");
      // 触れる図か否か（marker/circle を interactive にするとタップ経路が生まれる＝現在は無い）
      for (const m of src.matchAll(/(interactive|keyboard|dragging|scrollWheelZoom|doubleClickZoom|touchZoom|boxZoom|zoomControl|attributionControl):\s*(\w+)/g))
        add("map:interactive", `${m[1]}:${m[2]}`);
    }

    // ⑥ イベント登録（Leaflet破棄事故・スワイプ判定の回帰を見る）
    for (const m of src.matchAll(/(add|remove)EventListener\(\s*["'`](\w+)["'`]/g)) add("event:dom", `${m[1]}:${m[2]}`);
    for (const m of src.matchAll(/passive:\s*(\w+)/g)) add("event:passive", `passive:${m[1]}`);

    // ⑦ URL / hash
    for (const m of src.matchAll(/(?:location\.hash\s*=\s*|pushState\([^,]*,\s*""\s*,\s*)["'`]([^"'`]+)["'`]/g)) add("url:hash", m[1]);
    for (const m of src.matchAll(/(\w*HASH_RE)\s*=\s*(\/.*?\/);/g)) add("url:regex", `${m[1]} = ${m[2]}`);
    for (const m of src.matchAll(/sessionStorage\.(getItem|setItem|removeItem)\(\s*["'`](\w+)["'`]/g)) add("url:session", `${m[2]}`);
    for (const m of src.matchAll(/localStorage\.(getItem|setItem|removeItem)\(\s*["'`](\w+)["'`]/g)) add("url:local", `${m[2]}`);

    // ⑧ 役割別の見え方（訪問者 / ログイン / 管理者 / 自分の求人）
    for (const m of src.matchAll(/isAdmin\(\s*(\w+)\s*\)/g)) add("role:isAdmin", `isAdmin(${m[1]})`);
    for (const m of src.matchAll(/\bvisitor\s*=\s*\{?\s*!(\w+)/g)) add("role:visitor", `visitor=!${m[1]}`);
    for (const m of src.matchAll(/const (isOwnJob|ownLoaded|showConsignLane|appPending|myAppLoaded)\s*=\s*([^;]+);/g))
      add("role:derived", `${m[1]} = ${flat(m[2])}`);

    // ⑨ キャッシュのキー（表示専用・冷間復元の経路）
    for (const m of src.matchAll(/(?:getCache|setCache)\(\s*["'`]([^"'`]+)["'`]/g)) add("cache:key", m[1]);
    for (const m of src.matchAll(/snapGet\(\s*["'`](\w+)["'`]/g)) add("cache:snap", m[1]);
  }

  // ── api:call（2026-08-18・4-A2.1で追加）────────────────────────
  // 窓口（jobSearchApi.js／lib/searchJobs.js）の各関数を、画面側が何回呼ぶか。
  // data:* を「形の集合」にしたことで失った回数の検出力を、構造分割に耐える位置で取り戻す：
  // 同じ問い合わせを誤って2回発火させる／呼ぶのをやめる、が差分に出る。
  const apiNames = new Set();
  for (const f of FILES) {
    if (!/Api\.js$|searchJobs\.js$/.test(f)) continue;
    const src = read(f);
    if (src == null) continue;
    for (const m of src.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)) apiNames.add(m[1]);
  }
  for (const f of FILES) {
    if (/Api\.js$|searchJobs\.js$/.test(f)) continue; // 窓口の定義自体は数えない
    let src = read(f);
    if (src == null) continue;
    src = src.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*$/gm, ""); // import行は呼び出しではない
    for (const name of apiNames) {
      const n = (src.match(new RegExp(`\\b${name}\\(`, "g")) || []).length;
      for (let i = 0; i < n; i++) add("api:call", name);
    }
  }
  return sec;
}

function render(sec) {
  const out = ["# さがす（求人検索）の指紋", ""];
  for (const k of Object.keys(sec).sort()) {
    out.push(`## ${k}`);
    // data:* は【操作の形の集合】で見る（回数では見ない）。
    // 理由：同じ問い合わせを窓口関数へ集約すると呼び出し回数は必ず減る＝構造移動のたびに鳴り、
    // 検出器として役に立たなくなる。表・RPC・列・絞り込み・メソッドの【種類】が増減したときだけ鳴らす。
    const uniq = k.startsWith("data:");
    const lines = uniq ? [...new Set(sec[k])].sort() : bag(sec[k]);
    for (const l of lines) out.push(`  ${l}`);
    out.push("");
  }
  return out.join("\n");
}

const BASE = path.join("scripts", "search-fingerprint.baseline.txt");
const NOTE_MARK = "# ── 採取時点のDB実測（静的解析では出ない値）";
const text = render(collect());

if (process.argv.includes("--write")) {
  const old = read(BASE) || "";
  const note = old.includes(NOTE_MARK) ? "\n" + old.slice(old.indexOf(NOTE_MARK)) : "";
  fs.writeFileSync(BASE, text + note);
  console.log("baseline を更新しました:", BASE);
} else if (process.argv.includes("--check")) {
  const old = read(BASE);
  if (old == null) { console.error("baseline がありません。先に --write で採取してください"); process.exit(1); }
  const cut = (s) => (s.includes(NOTE_MARK) ? s.slice(0, s.indexOf(NOTE_MARK)) : s).trimEnd();
  const a = cut(old).split("\n"), b = cut(text).split("\n");
  const lost = a.filter((l) => !b.includes(l) && l.trim());
  const gained = b.filter((l) => !a.includes(l) && l.trim());
  if (!lost.length && !gained.length) { console.log("指紋一致（検索の意味論に差分なし）"); process.exit(0); }
  console.error("★指紋に差分があります");
  for (const l of lost) console.error("  - " + l);
  for (const l of gained) console.error("  + " + l);
  process.exit(1);
} else {
  console.log(text);
}
