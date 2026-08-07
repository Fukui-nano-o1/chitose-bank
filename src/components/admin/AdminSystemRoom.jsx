// システム専用ページ（#/admin/system・管理者専用・2026-08-03たきと指示「システムページを作れ。
// システムタップで遷移。全て横スワイプで切り替えられるように」）：
// 管理タブ「その他＞システム」のポップアップ＋区画表示（エラー／画像軽量化）を独立ページ化。
// 各面はネイティブ横スクロール＋scroll-snap（指に追従・1スワイプ1面＝WorkerExperienceEntriesSwipeと
// 同じ作法）で切り替え、上部タブのタップでも移動できる。
// 書き込みは従来と同一の2つだけ（エラーの解決済み化・画像ツールの上書き）＝新しい保存機能は無い
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { recompressBucket, generateJobPhotoThumbs } from "../../lib/image";
// エラーの辞書・分類・グループ化は lib/errorCatalog に集約（2026-08-07・画面上部の管理者帯と共有）
import { explainError, deviceLabel, groupAppErrors } from "../../lib/errorCatalog";
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

// 種類の具体的な事実（展開表示とコピー報告文の両方が使う唯一のソース）
function groupFacts(g) {
  const userN = new Set(g.rows.filter(r => r.user_id).map(r => r.user_id)).size;
  const anonN = g.rows.filter(r => !r.user_id).length;
  const tally = (fn) => {
    const t = {};
    g.rows.forEach(r => { const k = fn(r); t[k] = (t[k] || 0) + 1; });
    return Object.entries(t).sort((a, b) => b[1] - a[1]);
  };
  return { userN, anonN, devs: tally(r => deviceLabel(r.user_agent)), pages: tally(r => r.page || "-") };
}
// 状況の報告文（2026-08-07たきと指示「コピーボタンを各エラーに設置。君にどんな状況か説明できる状態にする」）：
// AIや開発者にそのまま貼れる自己完結のテキスト。個人情報は入れない（user_idは人数のみ・メール等なし）
function buildErrorReport(g, catLabel, ex, stackText) {
  const f = groupFacts(g);
  const jp = (d) => new Date(d).toLocaleString("ja-JP");
  const L = g.latest;
  return [
    "【エラー状況の報告】chitose-bank 管理・システムページから生成",
    `■ 種類: ${ex ? ex.title : "（辞書に該当なし）"}`,
    `■ 大分類: ${catLabel}`,
    `■ 状態: 未解決${g.openIds.length}件／記録${g.rows.length}件（直近500件の集計）`,
    `■ 生メッセージ: ${L.message || "(なし)"}`,
    `■ 発生場所: 部品=${L.component || "-"}／発生源=${L.source || "-"}／操作=${L.operation || "-"}／エラーコード=${L.error_code || "-"}`,
    `■ 期間: ${jp(g.first.created_at)} 〜 ${jp(L.created_at)}`,
    `■ 影響: ログイン利用者${f.userN}人・未ログインの発生${f.anonN}件`,
    `■ 端末: ${f.devs.map(([k, n]) => `${k} ${n}件`).join("・")}`,
    `■ ページ: ${f.pages.slice(0, 5).map(([k, n]) => `${k}（${n}）`).join("・")}${f.pages.length > 5 ? " ほか" : ""}`,
    "■ 最近の発生（最大5件）:",
    ...g.rows.slice(0, 5).map(e => `- ${jp(e.created_at)}　${e.page || "-"}　${deviceLabel(e.user_agent)}${e.status === "fixed" ? "　✓解決済み" : ""}`),
    ex ? `■ 既知の説明: 原因=${ex.cause}／どうする=${ex.action}` : "■ 既知の説明: なし（辞書未登録の型）",
    "■ スタック（最新1件・先頭）:",
    stackText || "（取得できませんでした）",
  ].join("\n");
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
  // スタックは重いので一覧では取らず、種類を展開・コピーした時に最新1件だけ取りにいく
  // （保存は先頭15行＝コピー報告文用。画面表示は先頭6行に切って出す）
  const [stackBySig, setStackBySig] = useState({});
  const fetchStack = async (g) => {
    const res = await supabase.from("app_errors").select("stack").eq("id", g.latest.id).maybeSingle();
    const stack = (!res.error && res.data?.stack) ? res.data.stack.split("\n").slice(0, 15).join("\n") : "";
    setStackBySig(prev => ({ ...prev, [g.sig]: stack }));
    return stack;
  };
  const loadStack = (g) => {
    if (stackBySig[g.sig] !== undefined) return;
    setStackBySig(prev => ({ ...prev, [g.sig]: null }));   // null=取得中
    fetchStack(g);
  };
  // 画面上部の管理者帯（AdminErrorStrip）から来た時は、渡された種類を最初から展開して見せる
  // （2026-08-07たきと指示「タップで、システムのエラーへ遷移」の着地側）。1回で消費する
  useEffect(() => {
    if (appErrors === null) return;
    let sig = null;
    try { sig = sessionStorage.getItem("cb_sysErrorFocus"); if (sig) sessionStorage.removeItem("cb_sysErrorFocus"); } catch {}
    if (!sig) return;
    const g = groupAppErrors(appErrors).flatMap(c => c.groups).find(x => x.sig === sig);
    if (g) { setExpandedSig(sig); loadStack(g); }
    // loadStack/stackBySigはこの1回の消費にだけ使う（依存に入れると展開のたび再走するため外す）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appErrors]);
  // 状況をコピー（各種類カードの📋）。スタック未取得なら1件だけ取ってから報告文を作る
  // ※awaitを挟んでもiOSのユーザー操作猶予（約5秒）内so clipboard は通る。失敗時はalertで案内
  const [copiedSig, setCopiedSig] = useState(null);
  const copyGroup = async (g, catLabel, ex) => {
    let stack = stackBySig[g.sig];
    if (stack === undefined || stack === null) { try { stack = await fetchStack(g); } catch { stack = ""; } }
    const text = buildErrorReport(g, catLabel, ex, stack);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSig(g.sig);
      setTimeout(() => setCopiedSig(prev => (prev === g.sig ? null : prev)), 2000);
    } catch {
      alert("コピーできませんでした。もう一度タップしてください。");
    }
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
                            {/* ヘッダーは div＋onClick（📋ボタンを入れ子にするため。button入れ子は不正HTML） */}
                            <div onClick={() => { setExpandedSig(isOpen ? null : g.sig); if (!isOpen) loadStack(g); }}
                              style={{ display:"block", width:"100%", textAlign:"left", padding:"13px 16px", cursor:"pointer" }}>
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
                                <button type="button" onClick={(ev) => { ev.stopPropagation(); copyGroup(g, c.l, ex); }}
                                  className="f-sans" style={{
                                    padding:"4px 12px", border:"1px solid #DDD", borderRadius:8, background:"#fff",
                                    fontSize:10, fontWeight:700, color: copiedSig === g.sig ? "#00A86B" : "#555",
                                    cursor:"pointer", flexShrink:0,
                                  }}>{copiedSig === g.sig ? "✓ コピー済" : "📋 コピー"}</button>
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
                              {/* 最新の日付は右下（2026-08-07たきと指示・上段は件数とコピーだけにして折り返しを防ぐ） */}
                              <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", textAlign:"right", marginTop:6 }}>
                                最新 {new Date(g.latest.created_at).toLocaleString("ja-JP")}
                              </p>
                            </div>
                            {isOpen && (() => {
                              // 具体的な事実（コピー報告文と同じ groupFacts から導出・追加の通信なし）
                              const { userN, anonN, devs, pages } = groupFacts(g);
                              const stackFull = stackBySig[g.sig];
                              // 保存は15行（コピー用）・画面は先頭6行だけ見せる
                              const stack = stackFull ? stackFull.split("\n").slice(0, 6).join("\n") : stackFull;
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
                                    <p>ページ：{pages.slice(0, 5).map(([k, n]) => `${k}（${n}）`).join("・")}{pages.length > 5 ? " ほか" : ""}</p>
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
