// エラーの辞書・分類・グループ化（2026-08-07切り出し）：
import { inputRecovery } from './inputRecovery.js';
import { diagnoseError, browserLabel, isServiceWorkerRegistrationError } from './errorDiagnosis.js';
export { diagnoseError, browserLabel, isServiceWorkerRegistrationError };
// AdminSystemRoom（システムページのエラー面）が使う唯一のソース。ここに置くのは
// React/DOM/supabase 非依存の純関数のみ（lib層の規則）。
// ★運営チャットへの投函（旧 AdminErrorChatReporter）は2026-08-31にDBトリガーへ移した
//   （trg_z_app_error_report・migration 20260831060413）＝errorSignature と同じ署名の規則を
//   SQL側にも写している。署名の規則を変えるときは両方を揃えること。
// ★既知バグを修理したら KNOWN_ERRORS に1行足す＋「修正済み」記載は修理の実日付と必ず一致させること
//   （誤った安心を表示しない・2026-08-07保守ルール）

// ── エラーの具体的説明（2026-08-07たきと指示「エラーをもっと具体的にして」）：
// ①既知エラー辞書＝本番で実際に起きた型を、開発記録（CLAUDE.md）に基づき
//   「何が起きたか・原因・どうするか（修理済みならその日付）」で説明する
// ②辞書に無いものも translateError が型から日本語へ翻訳する（識別子を埋め込んで具体化）
// 「Rejected」だけでは原因を特定できない。登録APIと当サイトの登録スクリプトが
// 両方あるスタックだけを対象とし、別の未処理例外を巻き込まない。

// matchは小文字化済みメッセージと元の記録を受け取る
export const KNOWN_ERRORS = [
  { match: (_m, e) => isServiceWorkerRegistrationError(e),
    title: "Service Workerの登録が拒否された",
    cause: "端末・実行環境がオフライン表示やプッシュ通知に使うService Workerの登録を拒否し、旧スクリプトが失敗を処理できなかった。この記録だけでは通常画面の表示停止は確認できない。",
    action: "2026-10-02に登録失敗を処理する修正を追加。登録できない環境では通常のオンライン表示を続ける。既存の記録は保持し、修正版の公開後も同じスタックで発生する場合は読み込まれたregisterSW.jsを確認する。" },
  { match: m => m.includes("importing a module script failed") || m.includes("dynamically imported module") || m.includes("loading chunk"),
    title: "更新直後の旧ファイル読み込み失敗",
    cause: "新しいデプロイの直後、開いたままの古い画面が、入れ替えで消えた旧ビルドのファイルを読みに行った。",
    action: "2026-08-16に自己修復を強化済み（新SWの有効化を待ってから再読込＝1回で新ビルドに乗る。それまでは更新中の案内を表示）。最終発生がそれ以前なら対応不要。以後も同一端末で連発するなら再発＝要調査。" },
  { match: m => m.includes("is_account_moderated") && m.includes(".catch is not"),
    title: "rpcの返り値に.catchを直接呼んだ（既知・修正済み）",
    cause: "supabaseのrpcが返すのはPromiseでなくthenableで、.catchを直接呼ぶと落ちる型。ログイン確認の1箇所にあった。",
    action: "2026-07-26にPromise.resolveで包む規約へ修正済み。最終発生がそれ以前なら対応不要。以後も出るなら再発＝要調査。" },
  { match: m => m.includes("getfullyear is not a function"),
    title: "キャッシュ復元で日付が文字列になった（既知・修理済み）",
    cause: "viewCacheのlocalStorage永続化でDateがJSON文字列になり、カレンダーのgetFullYear()で落ちた。",
    action: "2026-08-03に3層で修理済み（32e6df6）。それ以後の発生があれば再発＝要調査。" },
  { match: m => m.includes("minified react error #310"),
    title: "フックの数が描画のたびに変わった（React #310）",
    cause: "条件分岐や早期returnでuseState等の呼び出し数が描画間で変わると起きる。画面が真っ白になる。",
    action: "発生ページの部品を確認。rules-of-hooksのlintゲートで検出できる型。" },
  { match: m => m.includes("minified react error #31;") || m.includes("minified react error #31?"),
    title: "オブジェクトをそのまま画面に描画した（React #31）",
    cause: "文字列でなくオブジェクトをJSXに置くと起きる（{obj}を{obj.name}にする等の漏れ）。",
    action: "発生ページの表示式を確認。" },
  { match: m => m.includes("内の重い画像"),
    title: "管理タブのconfirm取り違え（既知・修理済み）",
    cause: "確認モーダル用のstate名confirmが素のconfirm()を隠し、画像の一括軽量化ボタンが必ず落ちていた。",
    action: "2026-07-29にwindow.confirmへ修正済み。以後の発生があれば再発＝要調査。" },
  { match: m => m.includes("before initialization"),
    title: "宣言より前に変数を使った（TDZ）",
    cause: "constの宣言行より上でその変数を参照した。buildは通るが実行時に真っ白になる型。",
    action: "no-use-before-defineゲート（2026-07-29常設）で検出できる。発生ページの部品を確認。" },
  { match: m => m.trim() === "script error.",
    title: "外部スクリプト起因（中身が見えない型）",
    cause: "別ドメインのスクリプト（ブラウザ拡張・Brave の Shields・Instagram等のアプリ内ブラウザの注入）で起きたエラーはブラウザが詳細を隠すため、この文言だけになる。このサイトは外部ドメインのスクリプトを読まないので、サイトのコードの外で起きたもの。",
    action: "2026-09-29以降は記録しない（logAppError が捨てる）。最終発生がそれ以前なら対応不要＝まとめて解決済みにしてよい。以後も出るなら古いJSを掴んだ端末＝様子見。" },
  { match: m => m.includes("window.ethereum") || m.includes("window.solana") || m.includes("window.phantom") || m.includes("window.web3"),
    title: "ブラウザのウォレット拡張が注入したスクリプトのエラー",
    cause: "Brave（iPhone）のウォレット・MetaMask・Coinbase Wallet 等がページの先頭に差し込むスクリプト（スタックが global code@サイトURL:1:N）が、window.ethereum 等を触る途中で落ちた型。このサイトは暗号資産ウォレットの口を一切使わない（参照ゼロ）ので、サイトのコードの外で起きたもの。",
    action: "2026-09-29以降は記録しない（logAppError が捨てる）。最終発生がそれ以前なら対応不要＝解決済みにしてよい。以後も出るなら古いJSを掴んだ端末＝様子見。" },
  { match: m => m.includes("_leaflet") || m.includes("layerpointtolatlng"),
    title: "地図部品（Leaflet）の内部エラー",
    cause: "地図の表示中に部品が片付いた等のタイミング問題で起きる型。",
    action: "件数が少なければ実害小。急増したら地図画面の操作手順を確認。" },
  { match: (m, e) => e.error_code === '42501' || m.includes("row-level security"),
    title: "保存に必要な権限を確認できない",
    cause: "DBが権限の条件により操作を拒否した。意図した制限か設定の問題かは、この記録だけでは確認できない。",
    action: "利用者にはアカウントと対象の確認を案内。時間をおく・ログインを繰り返すだけで直るとは案内しない。運営は対象操作と権限条件を照合する。" },
  { match: m => m.includes("duplicate key") || m.includes("unique constraint"),
    title: "重複データの書き込みを拒否",
    cause: "同じ組み合わせの行が既にある（二重応募のUNIQUE等、意図した壁のことが多い）。",
    action: "発生ページと操作を確認。保存済みの内容と今回の入力が一致するかを照合する。重複エラーだけで成功や対応不要とは判断しない。" },
  { match: m => m.includes("statement timeout"),
    title: "DBの応答が時間切れ",
    cause: "DBの処理が制限時間を超えた。負荷・ロック待ち・処理内容のどれが原因かは、この記録だけでは確認できない。",
    action: "利用者には入力を控えたうえで画面の確認手順を案内。運営は同時刻の発生と対象処理を確認し、反復する場合は調査する。" },
  { match: m => m.includes("api key is invalid") || m.includes("gomail") || m.includes("error sending"),
    title: "メール送信の失敗（SMTP設定）",
    cause: "Supabase AuthのSMTP鍵が無効だと、認証コードのメールが1通も送れない。",
    action: "ダッシュボードのSMTP設定と送信テストを確認（2026-08-04記録の型）。" },
  { match: m => m.includes("failed to fetch") || m.includes("load failed") || m.includes("networkerror"),
    title: "通信結果を受け取れなかった",
    cause: "通信・サーバー応答・ブラウザの制約などで結果を取得できなかった。原因や、保存処理が実行済みかは、この記録だけでは確認できない。",
    action: "保存操作なら結果未確認として扱い、画面にある同じ操作の確認手順を案内。新規データの作り直しやサイトデータ削除は勧めない。運営は集中発生や復帰不能を調査する。" },
];
// 辞書に無いメッセージを、型から日本語へ翻訳（識別子を埋め込んで具体化）。該当なしはnull
export function translateError(raw) {
  let m;
  if ((m = raw.match(/'?([\w.$]+)'? is not a function/i)))
    return { title: `「${m[1]}」を関数として呼んだが関数ではなかった`, cause: "ビルドの食い違い・型の取り違えで起きる型。", action: "発生ページと直前の操作を確認。" };
  if ((m = raw.match(/can't find variable:?\s*([\w$]+)/i)) || (m = raw.match(/\b([\w$]+) is not defined/i)))
    return { title: `変数「${m[1]}」が見つからない`, cause: "import漏れ・分割時の参照漏れの型（画面が真っ白になる）。", action: "該当部品のimportを確認（jsx-no-undefゲートの型）。" };
  if ((m = raw.match(/cannot read propert(?:y|ies) of (null|undefined)\s*\(reading '([\w$]+)'\)/i)))
    return { title: `空（${m[1]}）のデータから「${m[2]}」を読もうとした`, cause: "データが届く前・無い場合の分岐漏れ。", action: "発生ページの読み込み順とnullチェックを確認。" };
  if ((m = raw.match(/undefined is not an object \(evaluating '([^']+)'\)/i)))
    return { title: `空のデータから「${m[1]}」を読もうとした`, cause: "データが届く前・無い場合の分岐漏れ（iOS Safariの文言）。", action: "発生ページの読み込み順とnullチェックを確認。" };
  if (raw.match(/rendered more hooks than/i))
    return { title: "フックの数が前の描画より増えた", cause: "条件付きでuseState等を呼ぶ書き方がある。", action: "発生ページの部品を確認（rules-of-hooksの型）。" };
  return null;
}
export function explainError(e) {
  const diagnosis = diagnoseError(e);
  if (['chrome_ios_translate_request', 'chrome_ios_translate_candidate', 'css_resource', 'js_resource'].includes(diagnosis.key)) return diagnosis;
  const recovery = inputRecovery(e.error_code || e.code, e.reason);
  if (recovery) return { title: recovery.title,
    cause: recovery.state + 'この分類だけでは通信・権限・実装のどこが原因かは特定できない。',
    action: recovery.action + '復帰を確認するまでは解決済みにしない。同じ操作で続く場合は調査する。' };
  const low = (e.message || "").toLowerCase();
  for (const k of KNOWN_ERRORS) if (k.match(low, e)) return k;
  return translateError(e.message || "") || diagnosis;
}
// UAの自己申告を検出するだけ。Googleによる接続元の検証や権限判定には使わない。
export function isGooglebot(ua) {
  return /(?:^|[^a-z0-9_-])googlebot(?:-[a-z]+)?(?:\/|[\s;)]|$)/i.test(ua || "");
}
// 端末・アクセス元の内訳。巡回はAndroid等の判定より先に区別する。
export function deviceLabel(ua) {
  if (isGooglebot(ua)) return "Googlebot申告・未検証";
  const s = (ua || "").toLowerCase();
  if (!s) return "不明";
  if (s.includes("iphone") || s.includes("ipad")) return "iPhone/iPad";
  if (s.includes("android")) return "Android";
  return "PC";
}
// 発生ページ：page列が空でも url列のハッシュ部で代用する（2026-08-07）。
// window.onerror／unhandledrejection経路の logAppError は page を渡さないが、
// url=window.location.href は必ず記録されている（Script error.調査で「ページ：-」になった穴の修理）
export function errorPage(e) {
  if (e.page) return e.page;
  const u = e.url || "";
  const i = u.indexOf("#");
  if (i >= 0 && u.length > i + 1) return u.slice(i + 1);
  return "-";
}

// ── エラーのグループ細分化（2026-08-07たきと指示「エラーのグループを細分化する」）：
// 大分類（カテゴリ）→ 種類（部品×発生源×文言×細分類）→ 個々の発生、の3階層に束ねる。
// 同型の連発（例：デプロイ直後の読み込み失敗94件）が1枚に畳まれ、種類ごとにまとめて解決済みにできる
export const ERROR_CATEGORIES = [
  { k:"render",  l:"画面の描画失敗",     severity:"high",    desc:"描画失敗をエラー境界で捕捉した記録。全画面の停止や原因の特定とは区別します" },
  { k:"runtime", l:"JavaScript実行エラー", severity:"high", desc:"実行時の例外。画面の表示停止を確認した記録とは区別します" },
  { k:"async",   l:"非同期処理のエラー", severity:"unknown", desc:"未処理の非同期エラー。失敗した機能と画面への影響を確認する必要があります" },
  { k:"browser", l:"端末・ブラウザ機能", severity:"medium", desc:"Service Worker・ブラウザ翻訳など。原因候補と確認できた事実を分けて表示します" },
  { k:"deploy",  l:"JS・CSSの読み込み失敗", severity:"medium", desc:"必要なファイルの読み込み失敗。更新・通信・配信のどこに原因があるかは個別に確認します" },
  { k:"db",      l:"DB・権限",           severity:"high",    desc:"データベースの拒否・重複・タイムアウト" },
  { k:"network", l:"通信エラー",         severity:"medium",  desc:"通信失敗・中断。端末・回線・サーバーのどこに原因があるかは未確定です" },
  { k:"auth",    l:"ログイン・メール",   severity:"high",    desc:"認証コードの送信失敗など、入口の事故" },
  { k:"other",   l:"原因未特定",         severity:"unknown", desc:"既知の判定条件に一致しない記録。影響なしとは判断していません" },
];
// 細分類と同じ診断から大分類を決める。未処理Promiseだけで描画失敗とは判定しない。
export function errorCategoryKey(e) {
  return diagnoseError(e).category;
}
// 種類の署名＝部品×発生源×文言。UUID・4桁以上の数字列だけ伏せて同型を束ねる
// （短い数字は残す＝React error #310 と #31 を別の種類として混ぜない）
export function errorSignature(e) {
  const m = (e.message || "(メッセージなし)").slice(0, 200)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "{id}")
    .replace(/\d{4,}/g, "{n}");
  return [e.component || "", e.source || "", m].join("|");
}
// 取得は新しい順のでグループ内rows[0]が最新・末尾が初回
export function groupAppErrors(rows) {
  const bySig = new Map();
  for (const e of rows || []) {
    const notificationSig = errorSignature(e); // DB通知の互換性を維持する。
    const diagnosis = diagnoseError(e);
    // 同じLa/Rejectedでも原因・発生経路が異なる記録を一括解決しない。
    const sig = `${notificationSig}|${diagnosis.category}|${diagnosis.key}`;
    let g = bySig.get(sig);
    if (!g) { g = { sig, notificationSig, cat: diagnosis.category, rows: [], openIds: [] }; bySig.set(sig, g); }
    g.rows.push(e);
    if (e.status === "open") g.openIds.push(e.id);
  }
  const groups = [...bySig.values()].map(g => {
    const sorted = [...g.rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { ...g, rows: sorted, latest: sorted[0], first: sorted[sorted.length - 1] };
  });
  return ERROR_CATEGORIES.map(c => ({
    ...c,
    groups: groups.filter(g => g.cat === c.k)
      .sort((a, b) => (b.openIds.length - a.openIds.length) || (new Date(b.latest.created_at) - new Date(a.latest.created_at))),
  })).filter(c => c.groups.length > 0);
}

// 種類の具体的な事実（展開表示とコピー報告文の両方が使う唯一のソース）
export function groupFacts(g) {
  // 自称クローラーも利用者への影響から除外しない。過去の自己申告IDを認証済みと数えない。
  const verified = g.rows.filter(r => r.identity_verified === true);
  const unknownN = g.rows.length - verified.length;
  const botN = g.rows.filter(r => isGooglebot(r.user_agent)).length;
  const userN = new Set(verified.filter(r => r.user_id).map(r => r.user_id)).size;
  const anonN = verified.filter(r => !r.user_id).length;
  const tally = (fn) => {
    const t = {};
    g.rows.forEach(r => { const k = fn(r); t[k] = (t[k] || 0) + 1; });
    return Object.entries(t).sort((a, b) => b[1] - a[1]);
  };
  return { userN, anonN, unknownN, botN, devs: tally(r => deviceLabel(r.user_agent)), browsers: tally(r => browserLabel(r.user_agent)), pages: tally(r => errorPage(r)) };
}
export function errorImpactLabel({ userN, anonN, unknownN = 0, botN }) {
  return `認証確認済みの利用者${userN}人・未ログインの発生${anonN}件` +
    (unknownN > 0 ? `・認証状態を確認できない旧記録${unknownN}件` : "") +
    (botN > 0 ? `（うちGooglebot申告・未検証${botN}件）` : "");
}
// 状況の報告文（2026-08-07たきと指示「コピーボタンを各エラーに設置。君にどんな状況か説明できる状態にする」）：
// AIや開発者にそのまま貼れる自己完結のテキスト。個人情報は入れない（user_idは人数のみ・メール等なし）
export function buildErrorReport(g, catLabel, ex, stackText) {
  const f = groupFacts(g);
  const jp = (d) => new Date(d).toLocaleString("ja-JP");
  const L = g.latest;
  const d = diagnoseError(L);
  return [
    "【エラー状況の報告】chitose-bank 管理・システムページから生成",
    `■ 種類: ${ex ? ex.title : "（辞書に該当なし）"}`,
    `■ 大分類: ${catLabel}`,
    `■ 細分類: ${d.title}`,
    `■ 判定の確度: ${d.confidence}`,
    `■ 判定の根拠: ${d.evidence}`,
    `■ 発生元: ${d.origin}`,
    `■ 表示への影響: ${d.impact}`,
    `■ 状態: 未解決${g.openIds.length}件／記録${g.rows.length}件（直近500件の集計）`,
    `■ 生メッセージ: ${L.message || "(なし)"}`,
    `■ 発生場所: 部品=${L.component || "-"}／発生源=${L.source || "-"}／操作=${L.operation || L.action || "-"}／エラーコード=${L.error_code || "-"}`,
    `■ 期間: ${jp(g.first.created_at)} 〜 ${jp(L.created_at)}`,
    `■ 影響: ${errorImpactLabel(f)}`,
    `■ 端末・アクセス元: ${f.devs.map(([k, n]) => `${k} ${n}件`).join("・")}`,
    `■ ブラウザ（申告）: ${f.browsers.map(([k, n]) => `${k} ${n}件`).join("・")}`,
    `■ ページ: ${f.pages.slice(0, 5).map(([k, n]) => `${k}（${n}）`).join("・")}${f.pages.length > 5 ? " ほか" : ""}`,
    "■ 最近の発生（最大5件）:",
    ...g.rows.slice(0, 5).map(e => `- ${jp(e.created_at)}　${errorPage(e)}　${deviceLabel(e.user_agent)}${e.status === "fixed" ? "　✓解決済み" : ""}`),
    ex ? `■ 既知の説明: 原因=${ex.cause}／どうする=${ex.action}` : "■ 既知の説明: なし（辞書未登録の型）",
    ...(d.reference ? [`■ 参考資料: ${d.reference}（照合日：2026-10-27）`] : []),
    "■ スタック（最新1件・先頭）:",
    stackText || "（取得できませんでした）",
  ].join("\n");
}

// 種類の署名から短い符牒を作る（運営チャットへの投函が同じ種類を二度貼らないための目印・2026-08-16）
export function errorSigHash(sig) {
  let h = 5381;
  for (let i = 0; i < sig.length; i++) h = ((h * 33) ^ sig.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(7, "0").slice(0, 7);
}
