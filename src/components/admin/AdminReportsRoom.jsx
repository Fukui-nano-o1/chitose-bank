// 報告の集計を一本化した統合ページ（#/admin/reports・管理者専用・2026-08-15たきと指示
// 「入力の一本化はやめて、集計する方を一本化しよう」）。
// 4つの報告台帳（job_reports=求人／message_reports=コメント／profile_reports=人／feedback=画面）を
// 1つに束ね、タブ（すべて/求人/コメント/人/画面）で切り替える。横スワイプは指連動＝
// ネイティブ横スクロール＋scroll-snap（システムページAdminSystemRoomと同じ機構・2026-08-15たきと指示
// 「タブの切り替え。横スワイプで指連動」）。並びは全タブとも最新順（created_at降順）。
// カードの中身・「対応済みにする」の書き込みは旧AdminTab審査→通報節と同一
// （status:'resolved'への更新のみ＝新しい書き込みは作らない）。
// feedbackはこれまで運営UIが無かった（送れるのに見る場所が無い）＝この統合で初めて画面を持つ。
// status列と管理者UPDATEポリシーは migration 20260815060344 で追加済み。
// 表示は未対応のみ（解決済みはDBに残る＝システムページ2026-08-08と同じ方針）。
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { Dots } from "../ui";
import { AdminNav } from "./AdminNav";
import { openWorkerPreview } from "../../lib/previewBus";
import { getCache, setCache } from "../../lib/viewCache";
import { NavIconInline } from "../NavIcons";

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
const cardStyle = { border: "1px solid #EBEBEB", borderRadius: 12, padding: "16px", background: "#fff" };
const timeStyle = { fontSize: 11, color: "#B0B0B0", flexShrink: 0 };
const resolveBtn = { padding: "9px 18px", fontSize: 13, fontWeight: 700, background: "#00A86B", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer" };
const linkBtn = { padding: "9px 18px", fontSize: 13, fontWeight: 600, background: "#fff", color: "#717171", border: "1px solid #EBEBEB", borderRadius: 10, cursor: "pointer" };

export function AdminReportsRoom() {
  // items＝4台帳の未対応を1本に束ねた配列（kind付き・最新順）。viewCacheで前回内容を即描画→裏で最新化
  const [items, setItems] = useState(() => getCache("admin:reports") || null);
  const [busy, setBusy] = useState(null);

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
  };

  const countOf = (k) => (items || []).filter(r => k === "all" || r.kind === k).length;
  const kindLabel = (k) => (KINDS.find(x => x.k === k) || {}).l || k;

  // カードは1関数に一本化（5つの面が同じ描画を共有＝二重実装しない）
  const renderCard = (r) => (
    <div key={r.kind + r.id} style={cardStyle}>
      {/* 見出し行：ジャンルチップ＋要点＋時刻 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span className="f-sans" style={chipStyle}>{kindLabel(r.kind)}</span>
        <p className="f-sans" style={{ fontSize: 14, fontWeight: 700, color: r.kind === "screen" ? "#222" : "#E24B4A", margin: 0, flex: 1, minWidth: 0 }}>
          {r.kind === "pay" && <><NavIconInline name="flag" size={12} />未払いの申告　求人 #{r.job_number}</>}
          {r.kind === "job" && <>求人 #{r.job_number}　{r.issue_type}</>}
          {r.kind === "comment" && r.reason}
          {r.kind === "person" && r.issue_type}
          {r.kind === "screen" && (FB_LABEL[r.category] || r.category)}
        </p>
        <span className="f-sans" style={timeStyle}>{r.created_at ? new Date(r.created_at).toLocaleString("ja-JP") : ""}</span>
      </div>
      {/* 中身：台帳ごとの事実（旧AdminTab通報節と同じ項目） */}
      {r.kind === "pay" && (
        <>
          {/* 申告であって確定ではない（2026-08-20たきと裁定）＝言葉を間違えない。
              求人・契約・日次記録・最終回答は pay_incidents.snapshot に凍結済み（一覧では取らない） */}
          <p className="f-sans" style={{ fontSize: 12, color: "#717171", lineHeight: 1.7, margin: "0 0 8px" }}>
            状態：<b style={{ color: r.status === "checking" ? "#1E88E5" : "#E24B4A" }}>{PAY_STATUS_LABEL[r.status] || r.status}</b>　
            これは申告であって、未払いの確定ではありません。契約と日次の記録は申告時点の姿で凍結保存されています。
            必要に応じて双方へ事実確認をしてください（賃金は労基法24条の中心的義務）。
          </p>
          <p className="f-sans" style={{ fontSize: 11, color: "#B0B0B0", margin: "0 0 10px" }}>応募ID：{String(r.application_id || "").slice(0, 8)}…</p>
        </>
      )}
      {r.kind === "job" && (
        <p className="f-sans" style={{ fontSize: 12, color: "#717171", margin: "0 0 10px" }}>対象：{r.target_field}{r.detail ? `　${r.detail}` : ""}</p>
      )}
      {r.kind === "comment" && (
        <>
          <p className="f-sans" style={{ fontSize: 13, color: "#222", lineHeight: 1.7, margin: "0 0 8px", whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word", background: "#F7F7F7", borderRadius: 8, padding: "8px 10px" }}>{r.body_snapshot}</p>
          {r.detail && <p className="f-sans" style={{ fontSize: 12, color: "#717171", margin: "0 0 8px" }}>補足：{r.detail}</p>}
          <p className="f-sans" style={{ fontSize: 11, color: "#B0B0B0", margin: "0 0 10px" }}>応募ID：{String(r.application_id || "").slice(0, 8)}…　発言者：{String(r.sender_id_snapshot || "").slice(0, 8)}…　報告者：{String(r.reporter_id || "").slice(0, 8)}…</p>
        </>
      )}
      {r.kind === "person" && (
        <>
          <p className="f-sans" style={{ fontSize: 12, color: "#717171", margin: "0 0 8px" }}>面：{r.source === "work_record" ? "はたらいた記録" : "プロフィール"}　対象：{r.target_field}</p>
          {r.detail && <p className="f-sans" style={{ fontSize: 13, color: "#222", lineHeight: 1.7, margin: "0 0 8px", whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word", background: "#F7F7F7", borderRadius: 8, padding: "8px 10px" }}>{r.detail}</p>}
          <p className="f-sans" style={{ fontSize: 11, color: "#B0B0B0", margin: "0 0 10px" }}>相手：{String(r.target_worker_id || "").slice(0, 8)}…　報告者：{String(r.reporter_id || "").slice(0, 8)}…</p>
        </>
      )}
      {r.kind === "screen" && (
        <>
          {r.body && <p className="f-sans" style={{ fontSize: 13, color: "#222", lineHeight: 1.7, margin: "0 0 8px", whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word", background: "#F7F7F7", borderRadius: 8, padding: "8px 10px" }}>{r.body}</p>}
          <p className="f-sans" style={{ fontSize: 11, color: "#B0B0B0", margin: "0 0 10px" }}>ページ：{r.page_hash || "-"}　画面幅：{r.viewport || "-"}px</p>
        </>
      )}
      {/* 導線＋対応済み。求人=審査プレビューの深いリンク／人=働き手プレビュー（既存レール） */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {r.kind === "job" && (
          <button onClick={() => { window.location.hash = "/admin/review/" + r.job_number; }} className="f-sans" style={linkBtn}>求人を見る</button>
        )}
        {r.kind === "person" && (
          <button onClick={() => openWorkerPreview(r.target_worker_id)} className="f-sans" style={linkBtn}>働き手を見る</button>
        )}
        {r.kind === "pay" ? (
          <>
            {r.job_number != null && (
              <button onClick={() => { window.location.hash = "/admin/review/" + r.job_number; }} className="f-sans" style={linkBtn}>求人を見る</button>
            )}
            {r.status === "reported" && (
              <button onClick={() => setPayStatus(r, "checking")} disabled={busy === r.id} className="f-sans" style={{ ...linkBtn, color: "#1E88E5", borderColor: "#1E88E5", opacity: busy === r.id ? 0.6 : 1 }}>事実確認を始めた</button>
            )}
            <button onClick={() => { if (confirm("未解決のまま閉じます（記録は残ります）。よろしいですか？")) setPayStatus(r, "unresolved"); }} disabled={busy === r.id} className="f-sans" style={{ ...linkBtn, opacity: busy === r.id ? 0.6 : 1 }}>未解決で閉じる</button>
            <button onClick={() => setPayStatus(r, "resolved")} disabled={busy === r.id} className="f-sans" style={{ ...resolveBtn, opacity: busy === r.id ? 0.6 : 1 }}>解決にする</button>
          </>
        ) : (
          <button onClick={() => resolve(r)} disabled={busy === r.id} className="f-sans" style={{ ...resolveBtn, opacity: busy === r.id ? 0.6 : 1 }}>対応済みにする</button>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 14px 80px" }}>
      <AdminNav current="reports" />
      <p className="f-sans" style={{ fontSize: 12, color: "#717171", lineHeight: 1.7, margin: "0 0 12px" }}>
        利用者からの報告（未払いの申告・求人・チャットのコメント・人・画面）をここに集約しています。対応済み・解決済みは表示していません（記録は残ります）。
      </p>

      {/* タブ（タップでも移動・スワイプ中は現在面から点灯を導出）＝システムページと同じ視覚文法 */}
      <div style={{ display: "flex", borderBottom: "1px solid #EBEBEB", marginBottom: 16 }}>
        {KINDS.map((g, i) => (
          <button key={g.k} type="button" onClick={() => goTo(i)} className="f-sans"
            style={{ flex: 1, minWidth: 0, padding: "10px 0", background: "none", border: "none", whiteSpace: "nowrap",
              borderBottom: pageIdx === i ? "2px solid #222" : "2px solid transparent", marginBottom: -1,
              fontSize: 12, fontWeight: 700, color: pageIdx === i ? "#222" : "#999", cursor: "pointer" }}>
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
                  <div style={{ display: "grid", gap: 12 }}>{list.map(renderCard)}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
