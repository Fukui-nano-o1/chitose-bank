// エラーの辞書・分類・グループ化（2026-08-07切り出し）：
// AdminSystemRoom（システムページのエラー面）と AdminErrorStrip（画面上部の管理者専用帯）の
// 両方が使う唯一のソース。ここに置くのは React/DOM/supabase 非依存の純関数のみ（lib層の規則）。
// ★既知バグを修理したら KNOWN_ERRORS に1行足す＋「修正済み」記載は修理の実日付と必ず一致させること
//   （誤った安心を表示しない・2026-08-07保守ルール）

// ── エラーの具体的説明（2026-08-07たきと指示「エラーをもっと具体的にして」）：
// ①既知エラー辞書＝本番で実際に起きた型を、開発記録（CLAUDE.md）に基づき
//   「何が起きたか・原因・どうするか（修理済みならその日付）」で説明する
// ②辞書に無いものも translateError が型から日本語へ翻訳する（識別子を埋め込んで具体化）
// matchは小文字化済みメッセージを受け取る
export const KNOWN_ERRORS = [
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
    cause: "別ドメインのスクリプト（ブラウザ拡張等）で起きたエラーはブラウザが詳細を隠すため、この文言だけになる。",
    action: "件数が少なければ様子見。急増したら発生ページ・端末の偏りを見る。" },
  { match: m => m.includes("_leaflet") || m.includes("layerpointtolatlng"),
    title: "地図部品（Leaflet）の内部エラー",
    cause: "地図の表示中に部品が片付いた等のタイミング問題で起きる型。",
    action: "件数が少なければ実害小。急増したら地図画面の操作手順を確認。" },
  { match: m => m.includes("row-level security"),
    title: "DBがRLSで書き込みを拒否",
    cause: "その利用者に許可されていない書き込みが実行された＝UIの出し分けとDBの権限がズレている可能性。",
    action: "発生ページと操作を確認し、RLSポリシーと画面の条件を突き合わせる。" },
  { match: m => m.includes("duplicate key") || m.includes("unique constraint"),
    title: "重複データの書き込みを拒否",
    cause: "同じ組み合わせの行が既にある（二重応募のUNIQUE等、意図した壁のことが多い）。",
    action: "発生ページと操作を確認。壁として正しければ画面側の二重送信ガードを見る。" },
  { match: m => m.includes("statement timeout"),
    title: "DBの応答が時間切れ",
    cause: "nanoインスタンスのコールドスパイク（数秒かかる型）で起きることがある。",
    action: "同時刻に連発していなければ一過性。連発ならDB負荷を確認（2026-08-07応募取り消しの型）。" },
  { match: m => m.includes("api key is invalid") || m.includes("gomail") || m.includes("error sending"),
    title: "メール送信の失敗（SMTP設定）",
    cause: "Supabase AuthのSMTP鍵が無効だと、認証コードのメールが1通も送れない。",
    action: "ダッシュボードのSMTP設定と送信テストを確認（2026-08-04記録の型）。" },
  { match: m => m.includes("failed to fetch") || m.includes("load failed") || m.includes("networkerror"),
    title: "通信が届かなかった",
    cause: "電波の切れ目・圏外・サーバーの一時不調。利用者の端末側が大半。",
    action: "特定の時刻に集中していたらサーバー側（DB不調等）を疑う。散発なら様子見。" },
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
  const low = (e.message || "").toLowerCase();
  for (const k of KNOWN_ERRORS) if (k.match(low)) return k;
  return translateError(e.message || "");
}
// 端末の内訳（user_agentから大づかみに）
export function deviceLabel(ua) {
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
// 大分類（カテゴリ）→ 種類（部品×発生源×文言の署名）→ 個々の発生、の3階層に束ねる。
// 同型の連発（例：デプロイ直後の読み込み失敗94件）が1枚に畳まれ、種類ごとにまとめて解決済みにできる
export const ERROR_CATEGORIES = [
  { k:"deploy",  l:"更新の読み込み失敗", severity:"medium",  desc:"新しいデプロイの直後、開いたままの古い画面が旧ファイルを読みに行った型。再読み込みで直る（実害小）" },
  { k:"render",  l:"画面の表示エラー",   severity:"high",    desc:"画面が真っ白・表示できない型。コードの不具合の可能性が高い" },
  { k:"db",      l:"DB・権限",           severity:"high",    desc:"データベースの拒否・重複・タイムアウト" },
  { k:"network", l:"通信エラー",         severity:"medium",  desc:"電波・接続の一時的な問題が多い" },
  { k:"auth",    l:"ログイン・メール",   severity:"high",    desc:"認証コードの送信失敗など、入口の事故" },
  { k:"other",   l:"その他",             severity:"unknown", desc:"" },
];
// 判定順が大事：通信・DB・メールを先に拾い、最後に発生源ベースの表示エラーで受ける
// （Failed to fetch等はunhandledrejection経由で来るため、srcだけで判定すると表示エラーに飲まれる）
export function errorCategoryKey(e) {
  const msg = (e.message || "").toLowerCase();
  const code = (e.error_code || "").toLowerCase();
  const src = e.source || "";
  if (msg.includes("importing a module script failed") || msg.includes("dynamically imported module") || msg.includes("loading chunk") || msg.includes("loading css chunk")) return "deploy";
  if (msg.includes("failed to fetch") || msg.includes("load failed") || msg.includes("networkerror") || msg.includes("network error")) return "network";
  if (msg.includes("row-level security") || msg.includes("permission denied") || msg.includes("statement timeout") || msg.includes("duplicate key") || msg.includes("violates") || ["42501","42p13","57014","23505","22p02"].includes(code) || code.startsWith("pgrst")) return "db";
  if (msg.includes("smtp") || msg.includes("gomail") || msg.includes("magic link") || msg.includes("otp") || msg.includes("error sending") || (e.component || "") === "LoginScreen") return "auth";
  if (src === "error_boundary" || src === "window.onerror" || src === "unhandledrejection" || msg.includes("minified react error") || msg.includes("is not a function") || msg.includes("is not defined") || msg.includes("can't find variable") || msg.includes("cannot read propert") || msg.includes("undefined is not an object") || msg.includes("before initialization")) return "render";
  return "other";
}
// 種類の署名＝部品×発生源×文言。UUID・4桁以上の数字列だけ伏せて同型を束ねる
// （短い数字は残す＝React error #310 と #31 を別の種類として混ぜない）
export function errorSignature(e) {
  const m = (e.message || "(メッセージなし)").slice(0, 200)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "{id}")
    .replace(/\d{4,}/g, "{n}");
  return [e.component || "", e.source || "", m].join("|");
}
// 取得は新しい順soグループ内rows[0]が最新・末尾が初回
export function groupAppErrors(rows) {
  const bySig = new Map();
  for (const e of rows || []) {
    const sig = errorSignature(e);
    let g = bySig.get(sig);
    if (!g) { g = { sig, cat: errorCategoryKey(e), rows: [], openIds: [] }; bySig.set(sig, g); }
    g.rows.push(e);
    if (e.status === "open") g.openIds.push(e.id);
  }
  const groups = [...bySig.values()].map(g => ({ ...g, latest: g.rows[0], first: g.rows[g.rows.length - 1] }));
  return ERROR_CATEGORIES.map(c => ({
    ...c,
    groups: groups.filter(g => g.cat === c.k)
      .sort((a, b) => (b.openIds.length - a.openIds.length) || (new Date(b.latest.created_at) - new Date(a.latest.created_at))),
  })).filter(c => c.groups.length > 0);
}
