// システム専用ページ（#/admin/system・管理者専用・2026-08-03たきと指示「システムページを作れ。
// システムタップで遷移。全て横スワイプで切り替えられるように」）：
// 管理タブ「その他＞システム」のポップアップ＋区画表示（エラー／画像軽量化）を独立ページ化。
// 各面はネイティブ横スクロール＋scroll-snap（指に追従・1スワイプ1面＝WorkerExperienceEntriesSwipeと
// 同じ作法）で切り替え、上部タブのタップでも移動できる。
// 書き込みは従来と同一の2つだけ（エラーの解決済み化・画像ツールの上書き）＝新しい保存機能は無い
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { recompressBucket, generateJobPhotoThumbs } from "../../lib/image";
import { Dots } from "../ui";
import { AdminNav } from "./AdminNav";

// ── 画像一括処理のバックグラウンド実行（2026-08-03たきと指示「一括軽量化は一瞬で終了させろ。
// 何分も画面に張り付かなくてはならない」・AdminTabから移設）：進捗・結果を【モジュールレベル】に
// 置く＝ボタンを押したらすぐ画面を離れてよい。他のタブ・ページへ移動しても処理は裏で続き、
// このページに戻れば進捗や完了結果がここに残っている。
// ※アプリ自体（PWA/ブラウザのタブ）を閉じると中断されるが、両ツールとも冪等so
//   もう一度押せば「残りだけ」処理される（途中まで進んだ分は無駄にならない）
const imgTaskStore = {
  running: "",        // 実行中の軽量化バケット名（"" = なし）
  progress: "",       // "3/12"
  results: {},        // bucket → {candidates, replaced, savedBytes}
  thumbRunning: false,
  thumbProgress: "",
  thumbResult: null,
  listeners: new Set(),
};
const imgTaskNotify = () => imgTaskStore.listeners.forEach(fn => { try { fn(); } catch {} });

// ── エラーの具体的説明（2026-08-07たきと指示「エラーをもっと具体的にして」）：
// ①既知エラー辞書＝本番で実際に起きた型を、開発記録（CLAUDE.md）に基づき
//   「何が起きたか・原因・どうするか（修理済みならその日付）」で説明する
// ②辞書に無いものも translateError が型から日本語へ翻訳する（識別子を埋め込んで具体化）
// matchは小文字化済みメッセージを受け取る
const KNOWN_ERRORS = [
  { match: m => m.includes("importing a module script failed") || m.includes("dynamically imported module") || m.includes("loading chunk"),
    title: "更新直後の旧ファイル読み込み失敗",
    cause: "新しいデプロイの直後、開いたままの古い画面が、入れ替えで消えた旧ビルドのファイルを読みに行った。",
    action: "利用者が再読み込みすれば直る。デプロイ直後に集中しているなら実害小＝様子見でよい。" },
  { match: m => m.includes("is_account_moderated") && m.includes(".catch is not"),
    title: "rpcの返り値に.catchを直接呼んだ（既知・修正済み）",
    cause: "supabaseのrpcが返すのはPromiseでなくthenableで、.catchを直接呼ぶと落ちる型。ログイン確認の1箇所にあった。",
    action: "2026-07-26にPromise.resolveで包む規約へ修正済み。最終発生がそれ以前なら対応不要。以後も出るなら再発so要調査。" },
  { match: m => m.includes("getfullyear is not a function"),
    title: "キャッシュ復元で日付が文字列になった（既知・修理済み）",
    cause: "viewCacheのlocalStorage永続化でDateがJSON文字列になり、カレンダーのgetFullYear()で落ちた。",
    action: "2026-08-03に3層で修理済み（32e6df6）。それ以後の発生があれば再発so要調査。" },
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
    action: "2026-07-29にwindow.confirmへ修正済み。以後の発生があれば再発so要調査。" },
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
function translateError(raw) {
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
function explainError(e) {
  const low = (e.message || "").toLowerCase();
  for (const k of KNOWN_ERRORS) if (k.match(low)) return k;
  return translateError(e.message || "");
}
// 端末の内訳（user_agentから大づかみに）
function deviceLabel(ua) {
  const s = (ua || "").toLowerCase();
  if (!s) return "不明";
  if (s.includes("iphone") || s.includes("ipad")) return "iPhone/iPad";
  if (s.includes("android")) return "Android";
  return "PC";
}

// ── エラーのグループ細分化（2026-08-07たきと指示「エラーのグループを細分化する」）：
// 大分類（カテゴリ）→ 種類（部品×発生源×文言の署名）→ 個々の発生、の3階層に束ねる。
// 同型の連発（例：デプロイ直後の読み込み失敗94件）が1枚に畳まれ、種類ごとにまとめて解決済みにできる
const ERROR_CATEGORIES = [
  { k:"deploy",  l:"更新の読み込み失敗", severity:"medium",  desc:"新しいデプロイの直後、開いたままの古い画面が旧ファイルを読みに行った型。再読み込みで直る（実害小）" },
  { k:"render",  l:"画面の表示エラー",   severity:"high",    desc:"画面が真っ白・表示できない型。コードの不具合の可能性が高い" },
  { k:"db",      l:"DB・権限",           severity:"high",    desc:"データベースの拒否・重複・タイムアウト" },
  { k:"network", l:"通信エラー",         severity:"medium",  desc:"電波・接続の一時的な問題が多い" },
  { k:"auth",    l:"ログイン・メール",   severity:"high",    desc:"認証コードの送信失敗など、入口の事故" },
  { k:"other",   l:"その他",             severity:"unknown", desc:"" },
];
// 判定順が大事：通信・DB・メールを先に拾い、最後に発生源ベースの表示エラーで受ける
// （Failed to fetch等はunhandledrejection経由で来るため、srcだけで判定すると表示エラーに飲まれる）
function errorCategoryKey(e) {
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
function errorSignature(e) {
  const m = (e.message || "(メッセージなし)").slice(0, 200)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "{id}")
    .replace(/\d{4,}/g, "{n}");
  return [e.component || "", e.source || "", m].join("|");
}
// 取得は新しい順soグループ内rows[0]が最新・末尾が初回
function groupAppErrors(rows) {
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

const Card = ({ children, style }) => (
  <div className="ledger-card" style={{ padding:"16px 20px", ...style }}>{children}</div>
);

// 面の並びの正はここ1箇所（タブとスワイプ面はこの順で対応する）
// ※旧・面1「SQL」（notifications作成SQL・records列追加SQL）は2026-08-07に削除：
//   どちらも本番適用済みの旧遺物だった（notificationsは現役稼働中・recordsは旧事業データ）
const PANES = [
  { k:"errors", l:"エラー" },
  { k:"images", l:"画像軽量化" },
];

export function AdminSystemRoom() {
  // ── 横スワイプ機構：ネイティブ横スクロール＝指に追従。snapで必ず1面に着地。タブタップでも移動
  const scrollRef = useRef(null);
  const [pageIdx, setPageIdx] = useState(0);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    setPageIdx(Math.max(0, Math.min(PANES.length - 1, Math.round(el.scrollLeft / el.clientWidth))));
  };
  const goTo = (idx) => { const el = scrollRef.current; if (el) el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" }); };
  // ページの器（全幅・snap）。隣面との隙間はpaddingで作る（幅計算を1面=clientWidthに保つ）
  const paneStyle = { flex:"0 0 100%", boxSizing:"border-box", scrollSnapAlign:"start", padding:"0 2px", alignSelf:"flex-start" };

  // ── 画像タスクの購読（ストアはモジュールレベル＝画面を離れても処理は続く）
  const [, imgTick] = useState(0);
  useEffect(() => {
    const fn = () => imgTick(t => t + 1);
    imgTaskStore.listeners.add(fn);
    return () => { imgTaskStore.listeners.delete(fn); };
  }, []);
  const { running: imgOptRunning, progress: imgOptProgress, results: imgOptResults,
          thumbRunning: thumbGenRunning, thumbProgress: thumbGenProgress, thumbResult: thumbGenResult } = imgTaskStore;
  const runThumbGen = () => {
    if (imgTaskStore.thumbRunning || imgTaskStore.running) return;
    if (!window.confirm("サムネの無い求人写真にカード用サムネ（640px）を生成し、jobsのphotosに書き戻します。生成済みは飛ばすので、通常は数秒で終わります。よろしいですか？")) return;
    imgTaskStore.thumbRunning = true; imgTaskStore.thumbProgress = ""; imgTaskNotify();
    // awaitしない＝ボタンは即返す。処理は裏で続き、完了結果はストアに残る
    (async () => {
      const r = await generateJobPhotoThumbs(supabase, { onProgress: (d, t) => { imgTaskStore.thumbProgress = `${d}/${t}`; imgTaskNotify(); } });
      imgTaskStore.thumbRunning = false; imgTaskStore.thumbProgress = ""; imgTaskStore.thumbResult = r; imgTaskNotify();
    })();
  };
  const runRecompress = (bucket, maxSide, quality) => {
    if (imgTaskStore.running) return;
    if (!window.confirm(`${bucket} 内の重い画像（400KB以上）を圧縮して差し替えます。実行中は画面を離れてもかまいません。よろしいですか？`)) return;
    imgTaskStore.running = bucket; imgTaskStore.progress = ""; imgTaskNotify();
    (async () => {
      const r = await recompressBucket(supabase, bucket, { maxSide, quality, onProgress: (d, t) => { imgTaskStore.progress = `${d}/${t}`; imgTaskNotify(); } });
      imgTaskStore.running = ""; imgTaskStore.progress = "";
      imgTaskStore.results = { ...imgTaskStore.results, [bucket]: r };
      imgTaskNotify();
    })();
  };

  // ── エラーログ（app_errors・RLSで管理者のみ読める。null=読み込み中）
  // グループ集計のため直近500件（stackは重いので取らない・必要列のみ）
  const [appErrors, setAppErrors] = useState(null);
  const [expandedSig, setExpandedSig] = useState(null);
  const [errBulkBusy, setErrBulkBusy] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("app_errors")
          .select("id,created_at,source,page,component,action,operation,error_code,message,status,user_id,user_agent")
          .order("created_at", { ascending: false }).limit(500);
        setAppErrors(data || []);
      } catch { setAppErrors([]); }
    })();
  }, []);
  // スタックは重いので一覧では取らず、種類を展開した時に最新1件だけ取りにいく
  const [stackBySig, setStackBySig] = useState({});
  const loadStack = (g) => {
    if (stackBySig[g.sig] !== undefined) return;
    setStackBySig(prev => ({ ...prev, [g.sig]: null }));   // null=取得中
    (async () => {
      const res = await supabase.from("app_errors").select("stack").eq("id", g.latest.id).maybeSingle();
      const stack = (!res.error && res.data?.stack) ? res.data.stack.split("\n").slice(0, 6).join("\n") : "";
      setStackBySig(prev => ({ ...prev, [g.sig]: stack }));
    })();
  };
  // 種類ごとの一括解決（従来の1件ずつのstatus更新と同じ書き込みを、同型のid群にまとめて行うだけ）
  const resolveGroup = async (g) => {
    if (!g.openIds.length || errBulkBusy) return;
    if (!window.confirm(`この種類の未解決 ${g.openIds.length}件をまとめて解決済みにします。よろしいですか？`)) return;
    setErrBulkBusy(g.sig);
    const { error } = await supabase.from("app_errors")
      .update({ status:"fixed", resolved_at: new Date().toISOString() }).in("id", g.openIds);
    setErrBulkBusy("");
    if (error) { alert("更新に失敗しました：" + error.message); return; }
    const ids = new Set(g.openIds);
    setAppErrors(prev => (prev || []).map(x => ids.has(x.id) ? { ...x, status:"fixed" } : x));
  };

  return (
    <div className="appear cb-admin-page" style={{ maxWidth:640, margin:"0 auto", padding:"20px 16px 120px" }}>
      <AdminNav current="system" />

      {/* タブ（タップでも移動・スワイプ中は現在面から点灯を導出） */}
      <div style={{ display:"flex", borderBottom:"1px solid #EBEBEB", marginBottom:16 }}>
        {PANES.map((p, i) => (
          <button key={p.k} type="button" onClick={() => goTo(i)} className="f-sans"
            style={{ flex:1, padding:"10px 0", background:"none", border:"none",
              borderBottom: pageIdx === i ? "2px solid #222" : "2px solid transparent", marginBottom:-1,
              fontSize:13, fontWeight:700, color: pageIdx === i ? "#222" : "#999", cursor:"pointer" }}>{p.l}</button>
        ))}
      </div>

      <div ref={scrollRef} onScroll={onScroll}
        style={{ display:"flex", alignItems:"flex-start", overflowX:"auto", WebkitOverflowScrolling:"touch",
          scrollSnapType:"x mandatory", overscrollBehaviorX:"contain", touchAction:"pan-x pan-y" }}>

        {/* ── 面1：エラー（グループ細分化：大分類→種類→個々の発生・2026-08-07） ── */}
        <div style={paneStyle}>
          {appErrors === null ? (
            <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>
          ) : appErrors.length === 0 ? (
            <div style={{ textAlign:"center", padding:"48px 0", color:"#B0B0B0" }}>
              <p className="f-sans" style={{ fontSize:14 }}>エラーは記録されていません</p>
            </div>
          ) : (() => {
            const cats = groupAppErrors(appErrors);
            const openTotal = appErrors.filter(x => x.status === "open").length;
            const kindTotal = cats.reduce((s, c) => s + c.groups.length, 0);
            return (
              <div style={{ display:"grid", gap:20 }}>
                <p className="f-sans" style={{ fontSize:12, color:"#717171" }}>
                  未解決 <b style={{ color:"#222" }}>{openTotal}件</b>・{kindTotal}種類（直近{appErrors.length}件から集計）
                </p>
                {cats.map(c => (
                  <div key={c.k}>
                    <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                      <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222" }}>{c.l}</p>
                      <span className="f-sans" style={{ fontSize:11, color:"#999" }}>
                        未解決{c.groups.reduce((s, g) => s + g.openIds.length, 0)}件・{c.groups.length}種類
                      </span>
                    </div>
                    {c.desc && <p className="f-sans" style={{ fontSize:11, color:"#999", margin:"2px 0 8px" }}>{c.desc}</p>}
                    <div style={{ display:"grid", gap:8, marginTop: c.desc ? 0 : 8 }}>
                      {c.groups.map(g => {
                        const open = g.openIds.length;
                        const isOpen = expandedSig === g.sig;
                        const ex = explainError(g.latest);
                        return (
                          <div key={g.sig} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, boxShadow:"0 1px 3px rgba(0,0,0,0.04)", overflow:"hidden", opacity: open ? 1 : 0.65 }}>
                            <button type="button" onClick={() => { setExpandedSig(isOpen ? null : g.sig); if (!isOpen) loadStack(g); }}
                              style={{ display:"block", width:"100%", textAlign:"left", padding:"13px 16px", background:"none", border:"none", cursor:"pointer" }}>
                              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, marginBottom:6 }}>
                                <span style={{ display:"flex", alignItems:"center", gap:6 }}>
                                  {open > 0 ? (
                                    <span style={{
                                      padding:"2px 8px", borderRadius:8, fontSize:10, fontWeight:700,
                                      background: c.severity === "high" ? "#FCEBEB" : c.severity === "medium" ? "#FEF3E2" : "#F7F7F7",
                                      color: c.severity === "high" ? "#E24B4A" : c.severity === "medium" ? "#F5A623" : "#717171",
                                    }}>{c.severity === "high" ? "重大" : c.severity === "medium" ? "注意" : "不明"}</span>
                                  ) : (
                                    <span style={{ padding:"2px 8px", borderRadius:8, fontSize:10, fontWeight:700, background:"#E6F7EF", color:"#00A86B" }}>解決済み</span>
                                  )}
                                  <span className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#222" }}>×{g.rows.length}</span>
                                  {open > 0 && open < g.rows.length && (
                                    <span className="f-sans" style={{ fontSize:10, color:"#999" }}>（未解決{open}）</span>
                                  )}
                                </span>
                                <span className="f-sans" style={{ fontSize:10, color:"#B0B0B0", flexShrink:0 }}>
                                  最新 {new Date(g.latest.created_at).toLocaleString("ja-JP")}
                                </span>
                              </div>
                              {ex && (
                                <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", marginBottom:4 }}>{ex.title}</p>
                              )}
                              <p className="f-mono" style={{
                                fontSize: ex ? 10 : 11, color: ex ? "#999" : "#444", wordBreak:"break-all", marginBottom:6,
                                ...(isOpen ? {} : { display:"-webkit-box", WebkitLineClamp: ex ? 1 : 2, WebkitBoxOrient:"vertical", overflow:"hidden" }),
                              }}>{g.latest.message || "(メッセージなし)"}</p>
                              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                                {g.latest.component && <span className="tag" style={{ background:"#F7F7F7", color:"#717171" }}>{g.latest.component}</span>}
                                {g.latest.source && <span className="tag" style={{ background:"#F7F7F7", color:"#717171" }}>{g.latest.source}</span>}
                                {g.latest.operation && <span className="tag" style={{ background:"#F7F7F7", color:"#717171" }}>{g.latest.operation}</span>}
                                {g.latest.action && <span className="tag" style={{ background:"#F7F7F7", color:"#717171" }}>{g.latest.action}</span>}
                              </div>
                            </button>
                            {isOpen && (() => {
                              // 具体的な事実を集計（追加の通信なし・手元の500件から導出）
                              const userN = new Set(g.rows.filter(r => r.user_id).map(r => r.user_id)).size;
                              const anonN = g.rows.filter(r => !r.user_id).length;
                              const tally = (fn) => {
                                const t = {};
                                g.rows.forEach(r => { const k = fn(r); t[k] = (t[k] || 0) + 1; });
                                return Object.entries(t).sort((a, b) => b[1] - a[1]);
                              };
                              const devs = tally(r => deviceLabel(r.user_agent));
                              const pages = tally(r => r.page || "-").slice(0, 5);
                              const stack = stackBySig[g.sig];
                              return (
                                <div style={{ padding:"0 16px 14px", borderTop:"1px solid #F3F3F3" }}>
                                  {ex && (
                                    <div style={{ padding:"10px 12px", background:"#E6F7EF", borderRadius:8, borderLeft:"3px solid #00A86B", margin:"12px 0 0" }}>
                                      <p className="f-sans" style={{ fontSize:11, color:"#1B7A54", lineHeight:1.7 }}>
                                        <b>原因</b>：{ex.cause}<br /><b>どうする</b>：{ex.action}
                                      </p>
                                    </div>
                                  )}
                                  <div className="f-sans" style={{ fontSize:11, color:"#555", lineHeight:1.9, margin:"12px 0 0" }}>
                                    <p>期間：{new Date(g.first.created_at).toLocaleString("ja-JP")} 〜 {new Date(g.latest.created_at).toLocaleString("ja-JP")}</p>
                                    <p>影響：ログイン利用者 {userN}人{anonN > 0 ? `・未ログインの発生 ${anonN}件` : ""}</p>
                                    <p>端末：{devs.map(([k, n]) => `${k} ${n}件`).join("・")}</p>
                                    <p>ページ：{pages.map(([k, n]) => `${k}（${n}）`).join("・")}{tally(r => r.page || "-").length > 5 ? " ほか" : ""}</p>
                                  </div>
                                  <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"10px 0 4px" }}>最近の発生（最大5件）</p>
                                  <div style={{ display:"grid", gap:2 }}>
                                    {g.rows.slice(0, 5).map(e => (
                                      <p key={e.id} className="f-sans" style={{ fontSize:10, color:"#717171" }}>
                                        {new Date(e.created_at).toLocaleString("ja-JP")}　{e.page || "-"}　{deviceLabel(e.user_agent)}{e.status === "fixed" ? "　✓解決済み" : ""}
                                      </p>
                                    ))}
                                  </div>
                                  {stack === null && (
                                    <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", marginTop:8 }}>発生箇所（スタック）を取得中<Dots /></p>
                                  )}
                                  {stack ? (
                                    <>
                                      <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"10px 0 4px" }}>発生箇所（最新1件のスタック先頭）</p>
                                      <pre className="f-mono" style={{ fontSize:9, color:"#717171", background:"#F7F7F7", borderRadius:8, padding:"8px 10px", margin:0, overflowX:"auto", whiteSpace:"pre" }}>{stack}</pre>
                                    </>
                                  ) : null}
                                  {open > 0 && (
                                    <button onClick={() => resolveGroup(g)} disabled={!!errBulkBusy} style={{
                                      marginTop:10, padding:"7px 14px", border:"1px solid #00A86B44", borderRadius:8,
                                      background:"transparent", color:"#00A86B", fontSize:11, fontWeight:600,
                                      cursor: errBulkBusy ? "default" : "pointer",
                                    }}>{errBulkBusy === g.sig ? "更新中…" : `この種類の${open}件をまとめて解決済みにする`}</button>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* ── 面2：画像軽量化 ── */}
        <div style={paneStyle}>
          <div style={{ display:"grid", gap:16 }}>
            <Card>
              <p className="f-sans" style={{ fontSize:14,fontWeight:700,color:"#222",marginBottom:4 }}>画像の一括軽量化</p>
              <p className="f-sans" style={{ fontSize:11,color:"#717171",lineHeight:1.8,marginBottom:16 }}>
                圧縮なしで保存された既存の画像（400KB以上）をダウンロード→圧縮→同じ場所に上書きします。
                URLが変わらないため、求人・プロフィール・凍結済み契約の参照はそのまま。
                既に軽い画像・処理済みの画像はスキップ＝何度実行しても安全で、2回目以降はほぼ一瞬で終わります。
                実行は裏で進むため、開始後は画面を離れてかまいません（このページに戻れば進捗と結果が見えます）。
                使い方ガイドのスクショはガイドページ上部の専用ボタンで。
              </p>
              <div style={{ display:"grid", gap:10 }}>
                {[
                  { bucket:"avatars",    label:"アイコン（avatars）",    maxSide:512,  quality:0.8, note:"表示84px級→512pxに縮小" },
                  { bucket:"job-photos", label:"求人写真（job-photos）", maxSide:1600, quality:0.8, note:"圧縮導入(7/16)前の原寸写真を縮小" },
                ].map(b => (
                  <div key={b.bucket} style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                    <button onClick={()=>runRecompress(b.bucket, b.maxSide, b.quality)} disabled={!!imgOptRunning} className="f-sans" style={{ padding:"9px 16px", fontSize:12, fontWeight:700, background: imgOptRunning===b.bucket ? "#EBEBEB" : "#00A86B", color: imgOptRunning===b.bucket ? "#717171" : "#fff", border:"none", borderRadius:10, cursor: imgOptRunning ? "default" : "pointer" }}>
                      {imgOptRunning===b.bucket ? `軽量化中 ${imgOptProgress}…` : b.label}
                    </button>
                    <span className="f-sans" style={{ fontSize:11, color:"#999" }}>
                      {imgOptResults[b.bucket]
                        ? `完了：対象${imgOptResults[b.bucket].candidates}枚中 ${imgOptResults[b.bucket].replaced}枚を差し替え（約${Math.round(imgOptResults[b.bucket].savedBytes/1024/1024*10)/10}MB削減）`
                        : b.note}
                    </span>
                  </div>
                ))}
                {/* カード用サムネの後埋め（2026-08-02・②）：一覧カードは軽量サムネ(thumb)を読む。
                    thumbが無い既存写真（サムネ導入前のアップロード分）へ640pxサムネを生成する */}
                <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                  <button onClick={runThumbGen} disabled={thumbGenRunning || !!imgOptRunning} className="f-sans" style={{ padding:"9px 16px", fontSize:12, fontWeight:700, background: thumbGenRunning ? "#EBEBEB" : "#00A86B", color: thumbGenRunning ? "#717171" : "#fff", border:"none", borderRadius:10, cursor: (thumbGenRunning || imgOptRunning) ? "default" : "pointer" }}>
                    {thumbGenRunning ? `生成中 ${thumbGenProgress}…` : "カード用サムネ生成（job-photos）"}
                  </button>
                  <span className="f-sans" style={{ fontSize:11, color:"#999" }}>
                    {thumbGenResult
                      ? (thumbGenResult.error
                          ? `失敗：${thumbGenResult.error}`
                          : `完了：${thumbGenResult.made}枚生成（生成済みスキップ${thumbGenResult.skipped ?? 0}・失敗${thumbGenResult.failed}・求人${thumbGenResult.updatedJobs}件更新／全${thumbGenResult.total}枚）`)
                      : "サムネ無しの写真だけ後埋め（640px・生成済みは飛ばす＝通常は数秒）"}
                  </span>
                </div>
              </div>
            </Card>
          </div>
        </div>

      </div>
    </div>
  );
}
