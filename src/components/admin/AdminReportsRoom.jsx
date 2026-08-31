// 報告の集計を一本化した統合ページ（#/admin/reports・管理者専用・2026-08-15たきと指示
// 「入力の一本化はやめて、集計する方を一本化しよう」）。
// 4つの報告台帳（job_reports=求人／message_reports=コメント／profile_reports=人／feedback=画面）＋
// 未払いの申告（pay_incidents）を1つに束ね、タブ（すべて/未払い/求人/コメント/人/画面）で切り替える。
// 横スワイプは指連動＝ネイティブ横スクロール＋scroll-snap（AdminSystemRoomと同じ機構）。
// ★構成はAirbnb型（2026-08-31たきと指示「構成をAirbnbにしろ」）＝振る舞いだけを写した：
//   ・頭＝「← 報告（N）」タップで管理へ戻る・説明は右端の？に集約（契約記録と同じ頭）
//   ・一覧＝要点1行＋抜粋の短い行（Airbnbの受信箱の行）。ボックス展開はしない
//   ・行タップ＝白い全画面テイクオーバー（fixed inset:0 の白・左上←で一覧に戻る・
//     事実の全文は中身・実行ボタンは下部の固定バー＝FinalReviewSheet／契約詳細と同じ器）
// 「対応済みにする」の書き込みは従来と同一（status:'resolved'への更新のみ＝新しい書き込みは作らない）。
// 表示は未対応のみ（解決済みはDBに残る＝システムページ2026-08-08と同じ方針）。
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import { Dots } from "../ui";
import { openWorkerPreview } from "../../lib/previewBus";
import { getCache, setCache } from "../../lib/viewCache";

const KINDS = [
  { k: "all",     l: "すべて" },
  { k: "pay",     l: "未払い" },
  { k: "job",     l: "求人" },
  { k: "comment", l: "コメント" },
  { k: "person",  l: "人" },
  { k: "screen",  l: "画面" },
];
const KIND_TABLE = { pay: "pay_incidents", job: "job_reports", comment: "message_reports", person: "profile_reports", screen: "feedback" };
// 未払いの申告の状態（2026-08-20たきと裁定「未払い確定ではなく未払い申告」）。
// reported＝申告あり／checking＝運営が事実確認中／resolved＝解決／unresolved＝未解決で閉じた。
// resolved/unresolved は一覧から消える（記録はDBに残る＝この画面の従来方針）
const PAY_STATUS_LABEL = { reported: "申告あり（未確認）", checking: "事実確認中" };
// 画面の報告（feedback）のカテゴリ→日本語。入力側（FeedbackModal）のFEEDBACK_CATEGORIESと対応
const FB_LABEL = { confusing: "分かりにくい", broken: "動かない", typo: "誤字・表示", suggestion: "提案", other: "その他" };

const chipStyle = { fontSize: 11, fontWeight: 700, color: "#555", background: "#F2F2F2", borderRadius: 20, padding: "3px 10px", flexShrink: 0 };
const linkBtn = { padding: "10px 16px", fontSize: 13, fontWeight: 600, background: "#fff", color: "#555", border: "1px solid #DDD", borderRadius: 10, cursor: "pointer" };
// テイクオーバー下部バーのボタン（実行＝緑・脇役＝白枠）
const barPrimary = { flex: 1, padding: "13px 0", fontSize: 14, fontWeight: 700, background: "#00A86B", color: "#fff", border: "none", borderRadius: 12, cursor: "pointer" };
const barSecondary = { flex: 1, padding: "13px 0", fontSize: 14, fontWeight: 700, background: "#fff", color: "#555", border: "1.5px solid #DDD", borderRadius: 12, cursor: "pointer" };
// 事実の本文（引用ブロック）
const quoteStyle = { fontSize: 14, color: "#222", lineHeight: 1.8, margin: "0 0 10px", whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word", background: "#F7F7F7", borderRadius: 10, padding: "12px 14px" };

// 一覧の行の要点（1行）と抜粋（Airbnbの受信箱の行＝タイトル＋プレビュー）
function summaryOf(r) {
  if (r.kind === "pay")     return { head: `未払いの申告　求人 #${r.job_number}`, snip: PAY_STATUS_LABEL[r.status] || r.status };
  if (r.kind === "job")     return { head: `求人 #${r.job_number}　${r.issue_type || ""}`, snip: [r.target_field, r.detail].filter(Boolean).join("　") };
  if (r.kind === "comment") return { head: r.reason || "コメントの報告", snip: r.body_snapshot || "" };
  if (r.kind === "person")  return { head: r.issue_type || "人の報告", snip: r.detail || "" };
  return { head: FB_LABEL[r.category] || r.category || "画面の報告", snip: r.body || "" };
}

export function AdminReportsRoom() {
  // items＝5台帳の未対応を1本に束ねた配列（kind付き・最新順）。viewCacheで前回内容を即描画→裏で最新化
  const [items, setItems] = useState(() => getCache("admin:reports") || null);
  const [busy, setBusy] = useState(null);
  const [detail, setDetail] = useState(null); // 開いている1件（白い全画面テイクオーバー）
  const [helpOpen, setHelpOpen] = useState(false); // ？ボタンの説明シート

  // ── 横スワイプ機構（AdminSystemRoomと同じ）：ネイティブ横スクロール＝指に追従。snapで必ず1面に着地。タブタップでも移動
  const scrollRef = useRef(null);
  const [pageIdx, setPageIdx] = useState(0);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    setPageIdx(Math.max(0, Math.min(KINDS.length - 1, Math.round(el.scrollLeft / el.clientWidth))));
  };
  const goTo = (idx) => { const el = scrollRef.current; if (el) el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" }); };
  // ページの器（全幅・snap）。隣面との隙間はpaddingで作る（幅計算を1面=clientWidthに保つ）。
  // alignSelf:flex-start＝短い面が長い面の高さに引き伸ばされない
  const paneStyle = { flex: "0 0 100%", boxSizing: "border-box", scrollSnapAlign: "start", padding: "0 2px", alignSelf: "flex-start" };

  const load = useCallback(async () => {
    const [jr, mr, pr, fb, py] = await Promise.all([
      supabase.from("job_reports").select("*").order("created_at", { ascending: false }),
      supabase.from("message_reports").select("*").order("created_at", { ascending: false }),
      supabase.from("profile_reports").select("*").order("created_at", { ascending: false }),
      supabase.from("feedback").select("*").order("created_at", { ascending: false }),
      // 未払いの申告（2026-08-20）。snapshotは重いので一覧では取らない（状態と要点だけ）
      supabase.from("pay_incidents").select("id,application_id,job_number,status,created_at,admin_note").order("created_at", { ascending: false }),
    ]);
    // 失敗した台帳は手元の値を上書きしない（フェイルオープン規則・2026-08-07）
    if (jr.error && mr.error && pr.error && fb.error && py.error) { setItems(prev => prev || []); return; }
    const merged = [
      ...(jr.error ? [] : (jr.data || []).map(r => ({ ...r, kind: "job" }))),
      ...(mr.error ? [] : (mr.data || []).map(r => ({ ...r, kind: "comment" }))),
      ...(pr.error ? [] : (pr.data || []).map(r => ({ ...r, kind: "person" }))),
      ...(fb.error ? [] : (fb.data || []).map(r => ({ ...r, kind: "screen" }))),
      ...(py.error ? [] : (py.data || []).map(r => ({ ...r, kind: "pay" }))),
    ].filter(r => r.status !== "resolved" && r.status !== "unresolved")
     .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)); // 最新順（全タブ共通）
    setItems(merged);
    setCache("admin:reports", merged);
  }, []);
  useEffect(() => { load(); }, [load]);

  const resolve = async (r) => {
    if (busy) return;
    setBusy(r.id);
    const { error } = await supabase.from(KIND_TABLE[r.kind]).update({ status: "resolved" }).eq("id", r.id);
    setBusy(null);
    if (error) { alert("更新に失敗しました：" + error.message); return; }
    setItems(prev => {
      const next = (prev || []).filter(x => !(x.kind === r.kind && x.id === r.id));
      setCache("admin:reports", next);
      return next;
    });
    setDetail(null); // 一覧から消える＝テイクオーバーも閉じて一覧へ戻す
  };
  // 未払いの申告の状態遷移（reported→checking→resolved/unresolved）。checkingは一覧に残る＝
  // 「確認を始めた」の記録。resolved/unresolvedで一覧から消える（decided_atを刻む）
  const setPayStatus = async (r, status) => {
    if (busy) return;
    setBusy(r.id);
    const patch = { status, ...(status === "resolved" || status === "unresolved" ? { decided_at: new Date().toISOString() } : {}) };
    const { error } = await supabase.from("pay_incidents").update(patch).eq("id", r.id);
    setBusy(null);
    if (error) { alert("更新に失敗しました：" + error.message); return; }
    setItems(prev => {
      const next = (status === "checking")
        ? (prev || []).map(x => (x.kind === "pay" && x.id === r.id) ? { ...x, status } : x)
        : (prev || []).filter(x => !(x.kind === "pay" && x.id === r.id));
      setCache("admin:reports", next);
      return next;
    });
    // 開いている詳細も追従（checking＝状態表示を更新して開いたまま／解決・未解決＝一覧へ戻す）
    setDetail(prev => (prev && status === "checking") ? { ...prev, status } : null);
  };

  const countOf = (k) => (items || []).filter(r => k === "all" || r.kind === k).length;
  const kindLabel = (k) => (KINDS.find(x => x.k === k) || {}).l || k;

  // ── 一覧の行（Airbnbの受信箱の行）：チップ＋要点＋日付＋›。中身の全文と実行はテイクオーバーが担う
  const renderRow = (r) => {
    const { head, snip } = summaryOf(r);
    return (
      <button key={r.kind + r.id} type="button" onClick={() => setDetail(r)} className="f-sans"
        style={{ display: "block", width: "100%", textAlign: "left", background: "#fff", border: "1px solid #EBEBEB", borderRadius: 12, padding: "14px 16px", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="f-sans" style={chipStyle}>{kindLabel(r.kind)}</span>
          <span className="f-sans" style={{ fontSize: 14, fontWeight: 700, color: r.kind === "screen" ? "#222" : "#E24B4A", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{head}</span>
          <span className="f-sans" style={{ fontSize: 11, color: "#B0B0B0", flexShrink: 0 }}>{r.created_at ? new Date(r.created_at).toLocaleDateString("ja-JP") : ""}</span>
          <span aria-hidden="true" style={{ fontSize: 16, color: "#C8C8C8", flexShrink: 0, lineHeight: 1 }}>›</span>
        </div>
        {snip && <p className="f-sans" style={{ fontSize: 12, color: "#717171", margin: "6px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{snip}</p>}
      </button>
    );
  };

  // ── 詳細テイクオーバーの中身（台帳ごとの事実の全文＝旧カードと同じ項目・字は読みやすく一回り大きく）
  const renderDetailBody = (r) => (
    <>
      <p className="f-sans" style={{ fontSize: 12, color: "#B0B0B0", margin: "0 0 2px" }}>{r.created_at ? new Date(r.created_at).toLocaleString("ja-JP") : ""}</p>
      <p className="f-sans" style={{ fontSize: 18, fontWeight: 800, color: r.kind === "screen" ? "#222" : "#E24B4A", margin: "0 0 14px", lineHeight: 1.5 }}>{summaryOf(r).head}</p>
      {r.kind === "pay" && (
        <>
          {/* 申告であって確定ではない（2026-08-20たきと裁定）＝言葉を間違えない。
              求人・契約・日次記録・最終回答は pay_incidents.snapshot に凍結済み（一覧では取らない） */}
          <p className="f-sans" style={{ fontSize: 13, color: "#444", lineHeight: 1.9, margin: "0 0 10px" }}>
            状態：<b style={{ color: r.status === "checking" ? "#1E88E5" : "#E24B4A" }}>{PAY_STATUS_LABEL[r.status] || r.status}</b><br />
            これは申告であって、未払いの確定ではありません。契約と日次の記録は申告時点の姿で凍結保存されています。
            必要に応じて双方へ事実確認をしてください（賃金は労基法24条の中心的義務）。
          </p>
          <p className="f-sans" style={{ fontSize: 12, color: "#B0B0B0", margin: "0 0 12px" }}>応募ID：{String(r.application_id || "").slice(0, 8)}…</p>
        </>
      )}
      {r.kind === "job" && (
        <p className="f-sans" style={{ fontSize: 13, color: "#444", lineHeight: 1.9, margin: "0 0 12px" }}>対象：{r.target_field}{r.detail ? `　${r.detail}` : ""}</p>
      )}
      {r.kind === "comment" && (
        <>
          <p className="f-sans" style={quoteStyle}>{r.body_snapshot}</p>
          {r.detail && <p className="f-sans" style={{ fontSize: 13, color: "#444", lineHeight: 1.8, margin: "0 0 10px" }}>補足：{r.detail}</p>}
          <p className="f-sans" style={{ fontSize: 12, color: "#B0B0B0", margin: "0 0 12px" }}>応募ID：{String(r.application_id || "").slice(0, 8)}…　発言者：{String(r.sender_id_snapshot || "").slice(0, 8)}…　報告者：{String(r.reporter_id || "").slice(0, 8)}…</p>
        </>
      )}
      {r.kind === "person" && (
        <>
          <p className="f-sans" style={{ fontSize: 13, color: "#444", lineHeight: 1.9, margin: "0 0 10px" }}>面：{r.source === "work_record" ? "はたらいた記録" : "プロフィール"}　対象：{r.target_field}</p>
          {r.detail && <p className="f-sans" style={quoteStyle}>{r.detail}</p>}
          <p className="f-sans" style={{ fontSize: 12, color: "#B0B0B0", margin: "0 0 12px" }}>相手：{String(r.target_worker_id || "").slice(0, 8)}…　報告者：{String(r.reporter_id || "").slice(0, 8)}…</p>
        </>
      )}
      {r.kind === "screen" && (
        <>
          {r.body && <p className="f-sans" style={quoteStyle}>{r.body}</p>}
          <p className="f-sans" style={{ fontSize: 12, color: "#B0B0B0", margin: "0 0 12px" }}>ページ：{r.page_hash || "-"}　画面幅：{r.viewport || "-"}px</p>
        </>
      )}
      {/* 対象へ跳ぶ導線は中身に置く（実行の主役だけを下のバーに置く＝Airbnbの並び） */}
      {(r.kind === "job" || (r.kind === "pay" && r.job_number != null) || r.kind === "person") && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          {(r.kind === "job" || (r.kind === "pay" && r.job_number != null)) && (
            <button onClick={() => { window.location.hash = "/admin/review/" + r.job_number; }} className="f-sans" style={linkBtn}>求人を見る</button>
          )}
          {r.kind === "person" && (
            <button onClick={() => openWorkerPreview(r.target_worker_id)} className="f-sans" style={linkBtn}>働き手を見る</button>
          )}
        </div>
      )}
    </>
  );

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 14px 80px" }}>

      {/* 頭＝Airbnb型（契約記録と同じ）：「← 報告（N）」タップで管理へ・説明は右端の？に集約 */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, margin: "0 0 12px" }}>
        <button onClick={() => { window.location.hash = "/admin"; }} aria-label="管理に戻る" className="f-sans"
          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: "6px 4px", textAlign: "left" }}>
          <span style={{ fontSize: 20, lineHeight: 1, color: "#222" }} aria-hidden="true">←</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: "#222", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>報告{items !== null && countOf("all") > 0 ? `（${countOf("all")}）` : ""}</span>
        </button>
        <button onClick={() => setHelpOpen(true)} aria-label="このページの説明" className="f-sans"
          style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid #DDD", background: "#fff", color: "#555", fontSize: 15, fontWeight: 700, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>？</button>
      </div>

      {/* タブ（タップでも移動・スワイプ中は現在面から点灯を導出）＝システムページと同じ視覚文法。
          ★横スクロール可（2026-08-31たきと報告「文字の重複」）：flex:1で6等分すると
          「未払い（2）」等の件数つきラベルが枠からあふれて隣と重なる＝タブは中身なりの幅
          （flexShrink:0）にして、入り切らないぶんは指で送る */}
      <div className="admin-nav" style={{ display: "flex", borderBottom: "1px solid #EBEBEB", marginBottom: 16, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {KINDS.map((g, i) => (
          <button key={g.k} type="button" onClick={() => goTo(i)} className="f-sans"
            style={{ flexShrink: 0, padding: "10px 14px", background: "none", border: "none", whiteSpace: "nowrap",
              borderBottom: pageIdx === i ? "2px solid #222" : "2px solid transparent", marginBottom: -1,
              fontSize: 13, fontWeight: 700, color: pageIdx === i ? "#222" : "#999", cursor: "pointer" }}>
            {g.l}{items !== null && countOf(g.k) > 0 ? `（${countOf(g.k)}）` : ""}
          </button>
        ))}
      </div>

      {items === null ? (
        <p className="f-sans" style={{ textAlign: "center", color: "#999", fontSize: 13, padding: "40px 0" }}>読み込み中<Dots /></p>
      ) : (
        <div ref={scrollRef} onScroll={onScroll}
          style={{ display: "flex", alignItems: "flex-start", overflowX: "auto", WebkitOverflowScrolling: "touch",
            scrollSnapType: "x mandatory", overscrollBehaviorX: "contain", touchAction: "pan-x pan-y" }}>
          {KINDS.map(g => {
            const list = items.filter(r => g.k === "all" || r.kind === g.k);
            return (
              <div key={g.k} style={paneStyle}>
                {list.length === 0 ? (
                  <p className="f-sans" style={{ textAlign: "center", color: "#999", fontSize: 13, padding: "40px 0" }}>
                    {g.k === "all" ? "未対応の報告はありません" : `「${g.l}」の未対応の報告はありません`}
                  </p>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>{list.map(renderRow)}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ？ボタンの説明シート（頭から集約した文言・全画面被せは cb-box-overlay cb-lock-scroll 併用の標準形） */}
      {helpOpen && createPortal(
        <div onClick={() => setHelpOpen(false)} className="cb-box-overlay cb-lock-scroll" style={{ zIndex: 9600 }}>
          <div onClick={e => e.stopPropagation()} className="cb-sheet-up" style={{ background: "#fff", borderRadius: 16, padding: "22px 20px", maxWidth: 420, width: "100%", position: "relative" }}>
            <p className="f-sans" style={{ fontSize: 16, fontWeight: 800, color: "#222", margin: "0 0 10px" }}>報告ページとは</p>
            <p className="f-sans" style={{ fontSize: 13, color: "#444", lineHeight: 1.9, margin: "0 0 8px" }}>
              利用者からの報告（未払いの申告・求人・チャットのコメント・人・画面）を1か所に集約しています。
              行をタップすると中身と対応のボタンが開きます。
            </p>
            <p className="f-sans" style={{ fontSize: 13, color: "#444", lineHeight: 1.9, margin: 0 }}>
              対応済み・解決済みにしたものは一覧から消えますが、記録はデータベースに残ります。
            </p>
            <button onClick={() => setHelpOpen(false)} className="f-sans" style={{ width: "100%", marginTop: 16, padding: "13px", fontSize: 14, fontWeight: 700, background: "#222", color: "#fff", border: "none", borderRadius: 12, cursor: "pointer" }}>閉じる</button>
          </div>
        </div>,
        document.body
      )}

      {/* 行タップ＝白い全画面テイクオーバー（契約スナップショット詳細と同じ器）：
          左上←で一覧へ・事実の全文は縦スクロール・実行ボタンは下部の固定バー */}
      {detail && createPortal(
        <div className="cb-lock-scroll" style={{ position: "fixed", inset: 0, zIndex: 9600, background: "#fff", display: "flex", flexDirection: "column" }}>
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "calc(10px + env(safe-area-inset-top, 0px)) 16px 8px" }}>
            <button onClick={() => setDetail(null)} aria-label="報告の一覧に戻る" className="f-sans"
              style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid #EBEBEB", background: "#fff", color: "#222", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, padding: 0, flexShrink: 0 }}>←</button>
            <p className="f-sans" style={{ fontSize: 15, fontWeight: 800, color: "#222", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kindLabel(detail.kind)}の報告</p>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", padding: "6px 20px 24px" }}>
            <div style={{ maxWidth: 560, margin: "0 auto" }}>{renderDetailBody(detail)}</div>
          </div>
          <div style={{ flexShrink: 0, borderTop: "1px solid #EBEBEB", padding: "12px 20px calc(14px + env(safe-area-inset-bottom, 0px))", background: "#fff" }}>
            <div style={{ maxWidth: 560, margin: "0 auto", display: "flex", flexDirection: "column", gap: 8 }}>
              {detail.kind === "pay" ? (
                <>
                  <div style={{ display: "flex", gap: 8 }}>
                    {detail.status === "reported" && (
                      <button onClick={() => setPayStatus(detail, "checking")} disabled={busy === detail.id} className="f-sans" style={{ ...barSecondary, color: "#1E88E5", borderColor: "#1E88E5", opacity: busy === detail.id ? 0.6 : 1 }}>事実確認を始めた</button>
                    )}
                    <button onClick={() => { if (confirm("未解決のまま閉じます（記録は残ります）。よろしいですか？")) setPayStatus(detail, "unresolved"); }} disabled={busy === detail.id} className="f-sans" style={{ ...barSecondary, opacity: busy === detail.id ? 0.6 : 1 }}>未解決で閉じる</button>
                  </div>
                  <button onClick={() => setPayStatus(detail, "resolved")} disabled={busy === detail.id} className="f-sans" style={{ ...barPrimary, opacity: busy === detail.id ? 0.6 : 1 }}>解決にする</button>
                </>
              ) : (
                <button onClick={() => resolve(detail)} disabled={busy === detail.id} className="f-sans" style={{ ...barPrimary, opacity: busy === detail.id ? 0.6 : 1 }}>対応済みにする</button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
