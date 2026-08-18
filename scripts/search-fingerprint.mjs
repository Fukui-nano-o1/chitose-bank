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
// ★採取した値は【一切切り詰めない】（2026-08-18・4-A5b-0.1）。以前は見やすさのため220文字等で
//   切っていたが、periodDays の「休日を候補から除く」判定や mapJobPublicRow の expired の後半が
//   指紋に入らず、そこを壊しても鳴らない穴になっていた。意味を運ぶ塊を途中で切らない。
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
  "src/features/jobs/search/filters/searchFilterStorage.js",
  "src/features/jobs/search/components/JobDetailPanel.jsx",
  "src/features/jobs/search/components/ApplyPanel.jsx",
  "src/features/jobs/search/searchJobs.js",
  "src/features/jobs/search/jobSearchApi.js",
  // 今日ページ（Phase 4-B・2026-08-18）。検索とは別の面だが、同じ道具で最低限だけ固定する
  "src/components/TodayPage.jsx",
  "src/features/today/todayApi.js",
  "src/features/today/components/StagePanels.jsx",
  // 農家のお仕事タブ（Phase 5・2026-08-18）。求人の仕分け・応募者の絞り込み・書き込みRPCだけを固定する
  "src/components/FarmerDashboard.jsx",
  "src/features/farmer/dashboard/farmerDashboardApi.js",
  "src/features/farmer/dashboard/model.js",
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
    if (exp) add("rule:jobFlag", "expired: " + flat(exp[0]));
    // 比較関数つきの sort だけを拾う（引数なしの .sort() は文字列整列＝並び規則ではないので除く）
    for (const m of src.matchAll(/\.sort\(\s*\((\w+),\s*(\w+)\)\s*=>\s*([^;\n]*?)\)(?=[;,.\s)])/g))
      add("rule:sort", flat(`(${m[1]}, ${m[2]}) => ${m[3]}`));
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
        add(key, flat(m[1] !== undefined ? m[1] : m[0]));
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
    // storage のキー。リテラル直書きだけでなく、定数に逃がした場合も追う（2026-08-18・4-A4）。
    // ★理由：キーを const に括り出すのは正しい整理だが、リテラルしか見ない検出器では
    //   「キーが消えた」ように見えてしまう（実際には値は同じ）。1段だけ定数を解決する。
    //   解決できない式（変数の連結など）は "(不明)" として残し、黙って落とさない。
    const constStr = new Map();
    for (const m of src.matchAll(/^\s*(?:export\s+)?const (\w+)\s*=\s*["'`]([^"'`]+)["'`];/gm)) constStr.set(m[1], m[2]);
    const keyOf = (raw) => {
      const lit = raw.match(/^["'`]([^"'`]+)["'`]$/);
      if (lit) return lit[1];
      const id = raw.match(/^(\w+)$/);
      if (id && constStr.has(id[1])) return constStr.get(id[1]);
      return "(不明)";
    };
    for (const m of src.matchAll(/sessionStorage\.(?:getItem|setItem|removeItem)\(\s*([^,)]+?)\s*[,)]/g)) add("url:session", keyOf(m[1].trim()));
    for (const m of src.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*([^,)]+?)\s*[,)]/g)) add("url:local", keyOf(m[1].trim()));

    // ⑧ 役割別の見え方（訪問者 / ログイン / 管理者 / 自分の求人）
    for (const m of src.matchAll(/isAdmin\(\s*(\w+)\s*\)/g)) add("role:isAdmin", `isAdmin(${m[1]})`);
    for (const m of src.matchAll(/\bvisitor\s*=\s*\{?\s*!(\w+)/g)) add("role:visitor", `visitor=!${m[1]}`);
    for (const m of src.matchAll(/const (isOwnJob|ownLoaded|showConsignLane|appPending|myAppLoaded)\s*=\s*([^;]+);/g))
      add("role:derived", `${m[1]} = ${flat(m[2])}`);

    // ⑩ 応募の状態機械（2026-08-18・4-A5b-0で追加）
    // 応募まわりは「表示は正常なまま、押した先だけ違う」が起こる領域。
    // 例：myAppStatus==="approved" と "applied" のクリック先を取り違えても、
    // DB操作の種類も呼び出し回数も変わらないので data:* / api:call では鳴らない。
    // ここは【条件 → 何になるか】の対応そのものを1本ずつ持つ。
    // ★アンカーが見つからなければ黙って素通りせず止める。
    // ★2つに分けて見る（2026-08-18・4-A5b の分割に備えて）：
    //   状態機械の【定義】（applyBtnLabel 等）は、それを持つファイルで見る＝ファイル名でなく
    //   中身で判定する。分割で定義がどのファイルへ移っても追随し、移った先に無い anchor を
    //   探して exit(2) することもない。
    //   面の番号（applyConfirmStep）のような【使用】は、応募UIを持つどのファイルでも数える。
    const hasApplyMachine = src.includes("const applyBtnDisabled =");
    const isApplyUi = /JobSearchMapView\.jsx$|ApplyPanel\.jsx$/.test(f);
    if (isApplyUi) {
      // 値の中の // コメントを落とす（文言の推敲で鳴らせない。判定に効くのはコードだけ）
      const decomment = (t) => t.split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
      // 三項の連鎖（cond ? 値 : cond ? 値 : …）を「条件 => 値」の並びにほどく。
      // ★深さは ( [ { だけで数える。< > を数えると矢印 => の > で深さが壊れ、連鎖を1本も割れなくなる。
      // ★文字列の中の ? : では割らない。
      const chain = (text, key) => {
        const b = decomment(text).slice(decomment(text).indexOf("=") + 1).replace(/;\s*$/, "");
        let d = 0, q = null, cur = "", parts = [];
        for (let i = 0; i < b.length; i++) {
          const ch = b[i];
          if (q) { cur += ch; if (ch === q && b[i - 1] !== "\\") q = null; continue; }
          if (ch === '"' || ch === "'" || ch === "`") { q = ch; cur += ch; continue; }
          if ("([{".includes(ch)) d++;
          else if (")]}".includes(ch)) d--;
          if (d === 0 && (ch === "?" || ch === ":")) { parts.push(cur.trim()); cur = ""; continue; }
          cur += ch;
        }
        parts.push(cur.trim());
        for (let i = 0; i + 1 < parts.length; i += 2) add(key, `${flat(parts[i])} => ${flat(parts[i + 1])}`);
        if (parts.length % 2 === 1) add(key, `(既定) => ${flat(parts[parts.length - 1])}`);
      };
      const need = (re, key, label, asChain) => {
        const m = src.match(re);
        if (!m) { console.error(`★応募の不変条件が見つかりません（${label}）:`, f); process.exit(2); }
        if (asChain) chain(m[0], key); else add(key, flat(decomment(m[0])));
        return m[0];
      };
      // 押せるか・何と書いてあるか・どんな見た目か・押すとどこへ行くか
      if (hasApplyMachine) {
      need(/const applyBtnDisabled = [^\n;]+;/, "apply:disabled", "applyBtnDisabled");
      need(/const applyBtnLabel = [\s\S]*?\n    : "[^"]*";/, "apply:label", "applyBtnLabel", true);
      need(/const applyBtnStyle = [\s\S]*?\n    : \{\};/, "apply:style", "applyBtnStyle", true);
      const onClick = need(/const applyBtnOnClick = [\s\S]*?\n    : \(\(\) => \{[^\n]*\}\);/, "apply:onClick", "applyBtnOnClick", true);
      // 募集終了の判定と、その時に出す言葉
      need(/const recruitClosed = [^\n;]+;/, "apply:closed", "recruitClosed");
      need(/const hideApply = [^\n;]+;/, "apply:closed", "hideApply");
      need(/const closedLabel = [\s\S]*?期間終了）";/, "apply:closed", "closedLabel");
      need(/const closedLabelShort = [^\n;]+?;/, "apply:closed", "closedLabelShort");
      // 状態の出どころ
      need(/const myAppStatus = [^\n;]+;/, "apply:state", "myAppStatus");
      need(/const myAppLoaded = [^\n;]+;/, "apply:state", "myAppLoaded");
      need(/const appPending = [^\n;]+;/, "apply:state", "appPending");
      need(/const isPeriodJob = [^\n;]+;/, "apply:state", "isPeriodJob");
      // 期間求人の「来られる日」候補（休日を除く）
      need(/const periodDays = \(\(\) => \{[\s\S]*?\n  \}\)\(\);/, "apply:periodDays", "periodDays");
      // 求人を切り替えた時の後始末（消えると前の求人の選択が次に持ち越される）
      need(/useEffect\(\(\) => \{ setApplyConfirmOpen\(false\);[^\n]*\}, \[selectedJob\?\.id\]\);/, "apply:reset", "selectedJob変更時のreset");
      // 確認ボックスの初期値と面の数
      for (const m of src.matchAll(/const \[(applyConfirmOpen|applyConfirmStep|applyChoice|applyImgZoom|applyDates)[^\]]*\] = useState\(([^)]*)\);/g))
        add("apply:initial", `${m[1]} = ${m[2]}`);
      // 応募まわりの遷移先。★応募に関わる関数の中だけを見る（画面全体の hash は url:hash が持つ）
      const applyFns = [onClick];
      for (const re of [/const goPending = async \(\) => \{[\s\S]*?\n  \};/, /const doApply = async \(\) => \{[\s\S]*?\n  \};/,
                        /const handleApply = async \(\) => \{[\s\S]*?\n  \};/, /const cancelMyApplication = async \(\) => \{[\s\S]*?\n  \};/]) {
        const m = src.match(re);
        if (!m) { console.error("★応募の関数が見つかりません:", re, f); process.exit(2); }
        applyFns.push(m[0]);
      }
      for (const body of applyFns) {
        for (const m of decomment(body).matchAll(/window\.location\.hash = ("[^"]*"(?: \+ [\w.?]+)?)/g)) add("apply:goto", flat(m[1]));
        for (const m of decomment(body).matchAll(/setApplyReturn\(([^)]*)\)/g)) add("apply:goto", `setApplyReturn(${m[1]})`);
        for (const m of decomment(body).matchAll(/onRegister\(\)/g)) add("apply:goto", "onRegister()");
      }
      } // hasApplyMachine
      // 面の番号は【使用】＝応募UIを持つどのファイルでも数える（分割で確認ボックスが移っても総数が保たれる）
      for (const m of src.matchAll(/applyConfirmStep === (\d+)/g)) add("apply:step", `step===${m[1]}`);
      for (const m of src.matchAll(/setApplyConfirmStep\(([^)]*)\)/g)) add("apply:step", `setStep(${flat(m[1])})`);
    }

    // ⑪ 今日ページの用件と作業の状態（2026-08-18・4-Bで追加・最低限）
    // 「やること」は記録から導出する（表示用の別状態を持たない）＝導出の規則が変わると
    // 出る用件そのものが変わる。ここは用件の一覧・段階の綴り・実行するRPC・
    // 作業の進み（開始前／開始済み／終了／打刻修正）を読む列だけを固定する。
    if (/TodayPage\.jsx$|today\/.*\.jsx?$/.test(f)) {
      // 用件の綴りと、それぞれが叩くRPC（取り違えると別の用件が実行される）
      for (const m of src.matchAll(/^\s{4}(\w+):\s*\{ icon:"[^"]*", title:"([^"]*)"/gm)) add("today:todo", `${m[1]} = ${m[2]}`);
      for (const m of src.matchAll(/rpc:"(\w+)"/g)) add("today:todoRpc", m[1]);
      // 役割ごとに出る用件の並び（catalog）
      const cat = src.match(/const TODO_STAGE_CATALOG = \{[\s\S]*?\n  \};/);
      if (cat) add("today:catalog", flat(cat[0]));
      // 作業の進みを読む列（開始前／開始済み／終了／打刻修正の判定材料）
      for (const m of src.matchAll(/select\("(id,started_at[^"]*|id,application_id,proposed[^"]*)"/g)) add("today:punchCols", m[1]);
      for (const m of src.matchAll(/\b(started_at|farmer_confirmed_start_at|work_completed_at|worker_confirmed_end_at|started_declared|ended_declared|time_corrected)\b/g))
        add("today:punchField", m[1]);
      // 打刻修正の承認（当事者ゲートはDB側・ここは呼び方だけ）。
      // ★2026-08-18修正：受け渡す変数の【入れ物】は意味を運ばない（c.id を窓口へ通すと id になる）ので
      //   x.y は y に均す。均さないと、窓口へ集約しただけで鳴る＝構造移動で鳴る穴になっていた。
      //   均すのは前置きだけ＝p_id と p_approve の【取り違え】は今までどおり差分に出る。
      for (const m of src.matchAll(/decide_time_correction", \{ ([^}]*) \}/g))
        add("today:correction", flat(m[1]).replace(/\b[A-Za-z_$][\w$]*\.(\w+)/g, "$1"));
    }

    // ⑫ 農家のお仕事タブ（2026-08-18・Phase 5で追加・最低限）。
    // ここで固定するのは【壊れても画面が正常に見えるまま結果だけ変わる】境界だけ：
    //   ・求人がどのタブに入るか（作成中／公開中／期限切れ）
    //   ・応募者の絞り込みの作り方
    //   ・書き込みRPCの引数（承認と見送りは同じRPCで真偽だけが違う＝取り違えが最も怖い）
    //   ・働き手の情報の入手経路（承認済み列だけ返すRPC窓口を通っているか＝2026-08-07のプラポリ修理の回帰防止）
    //   ・また呼びたい名簿の絞り込み（farmer_id と worker_id の両方＝2026-07-16労働局回答③の範囲限定）
    if (/FarmerDashboard\.jsx$|farmer\/dashboard\/.*\.jsx?$/.test(f)) {
      for (const m of src.matchAll(/set(DbDrafts|DbActive|DbExpired)\(([\s\S]*?)\);\n/g))
        add("farmer:jobBucket", `${m[1]} = ${flat(m[2])}`);
      const af = src.match(/const APP_FILTERS = \[[\s\S]*?\n  \];/);
      if (af) add("farmer:appFilter", flat(af[0]));
      // 書き込みRPC：引数の【名前と並び】＋【直値】。
      // data:rpcArg は名前しか見ないので p_approve の true/false の取り違えを拾えない。ここが本命
      // （承認と見送りは同じ approve_application で真偽だけが違う）。
      // 変数式は名前を書かない＝窓口へ通して仮引数名が変わっても鳴らない（構造移動で鳴らせない）。
      for (const m of src.matchAll(/\.rpc\(\s*["'`](\w+)["'`]\s*,\s*\{([^}]*)\}/g)) {
        const args = flat(m[2]).split(",").map(x => x.trim()).filter(Boolean).map(x => {
          const kv = x.match(/^(p_\w+)\s*:\s*(.*)$/); if (!kv) return x;
          const lit = /^(true|false|null|-?\d+(\.\d+)?|["'`].*["'`])$/.test(kv[2].trim());
          return lit ? `${kv[1]}=${kv[2].trim()}` : kv[1];
        });
        add("farmer:rpcArg", `${m[1]}(${args.join(", ")})`);
      }
      // 働き手の情報を触る経路。生の worker_profiles を直に select したら差分に出る
      for (const m of src.matchAll(/(?:\.rpc\(\s*["'`](worker_\w+)["'`]|\.from\(\s*["'`](worker_profiles)["'`])/g))
        add("farmer:workerWindow", m[1] || `from:${m[2]}`);
      // ★行コメントを先に落とす：コメント中の「repeat_roster」の語が連鎖の起点になってしまい、
      //   本物の問い合わせ（Promise.all の中の select）を丸ごと飲み込んで取りこぼしていた
      const noCom = src.replace(/(^|[^:])\/\/.*$/gm, "$1");
      for (const c0 of joinCalls(noCom, "repeat_roster")) {
        // 行またぎの連鎖を1本につないだ結果には、Promise.all の隣の問い合わせまで入ってくる。
        // repeat_roster から次の supabase. までを切り出す＝窓口へ1本ずつ分けても形が変わらない
        let c = c0.slice(c0.indexOf("repeat_roster"));
        const nx = c.indexOf("supabase."); if (nx > 0) c = c.slice(0, nx);
        const ops = [];
        for (const m of c.matchAll(/\.(upsert|delete|select|insert|update)\(/g)) ops.push(m[1]);
        for (const m of c.matchAll(/\.eq\(\s*["'`](\w+)["'`]/g)) ops.push(`eq:${m[1]}`);
        for (const m of c.matchAll(/onConflict:\s*["'`]([^"'`]+)["'`]/g)) ops.push(`onConflict:${m[1]}`);
        if (ops.length) add("farmer:roster", ops.sort().join(" | "));
      }
    }

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
