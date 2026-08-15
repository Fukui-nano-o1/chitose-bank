// 報告の集計を一本化した統合ページ（#/admin/reports・管理者専用・2026-08-15たきと指示
// 「入力の一本化はやめて、集計する方を一本化しよう」）。
// 4つの報告台帳（job_reports=求人／message_reports=コメント／profile_reports=人／feedback=画面）を
// 1つの一覧に束ね、ジャンルピルで絞り込む。カードの中身・「対応済みにする」の書き込みは
// 旧AdminTab審査→通報節と同一（status:'resolved'への更新のみ＝新しい書き込みは作らない）。
// feedbackはこれまで運営UIが無かった（送れるのに見る場所が無い）＝この統合で初めて画面を持つ。
// status列と管理者UPDATEポリシーは migration 20260815060344 で追加済み。
// 表示は未対応のみ（解決済みはDBに残る＝システムページ2026-08-08と同じ方針）。
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { Dots } from "../ui";
import { AdminNav } from "./AdminNav";
import { openWorkerPreview } from "../../lib/previewBus";
import { getCache, setCache } from "../../lib/viewCache";

const KINDS = [
  { k: "all",     l: "すべて" },
  { k: "job",     l: "求人" },
  { k: "comment", l: "コメント" },
  { k: "person",  l: "人" },
  { k: "screen",  l: "画面" },
];
const KIND_TABLE = { job: "job_reports", comment: "message_reports", person: "profile_reports", screen: "feedback" };
// 画面の報告（feedback）のカテゴリ→日本語。入力側（FeedbackModal）のFEEDBACK_CATEGORIESと対応
const FB_LABEL = { confusing: "分かりにくい", broken: "動かない", typo: "誤字・表示", suggestion: "提案", other: "その他" };

const chipStyle = { fontSize: 11, fontWeight: 700, color: "#555", background: "#F2F2F2", borderRadius: 20, padding: "3px 10px", flexShrink: 0 };
const cardStyle = { border: "1px solid #EBEBEB", borderRadius: 12, padding: "16px", background: "#fff" };
const timeStyle = { fontSize: 11, color: "#B0B0B0", flexShrink: 0 };
const resolveBtn = { padding: "9px 18px", fontSize: 13, fontWeight: 700, background: "#00A86B", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer" };
const linkBtn = { padding: "9px 18px", fontSize: 13, fontWeight: 600, background: "#fff", color: "#717171", border: "1px solid #EBEBEB", borderRadius: 10, cursor: "pointer" };

export function AdminReportsRoom() {
  // items＝4台帳の未対応を1本に束ねた配列（kind付き・新しい順）。viewCacheで前回内容を即描画→裏で最新化
  const [items, setItems] = useState(() => getCache("admin:reports") || null);
  const [kind, setKind] = useState("all");
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const [jr, mr, pr, fb] = await Promise.all([
      supabase.from("job_reports").select("*").order("created_at", { ascending: false }),
      supabase.from("message_reports").select("*").order("created_at", { ascending: false }),
      supabase.from("profile_reports").select("*").order("created_at", { ascending: false }),
      supabase.from("feedback").select("*").order("created_at", { ascending: false }),
    ]);
    // 失敗した台帳は手元の値を上書きしない（フェイルオープン規則・2026-08-07）
    if (jr.error && mr.error && pr.error && fb.error) { setItems(prev => prev || []); return; }
    const merged = [
      ...(jr.error ? [] : (jr.data || []).map(r => ({ ...r, kind: "job" }))),
      ...(mr.error ? [] : (mr.data || []).map(r => ({ ...r, kind: "comment" }))),
      ...(pr.error ? [] : (pr.data || []).map(r => ({ ...r, kind: "person" }))),
      ...(fb.error ? [] : (fb.data || []).map(r => ({ ...r, kind: "screen" }))),
    ].filter(r => r.status !== "resolved")
     .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
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

  const list = items === null ? null : items.filter(r => kind === "all" || r.kind === kind);
  const countOf = (k) => (items || []).filter(r => k === "all" || r.kind === k).length;
  const kindLabel = (k) => (KINDS.find(x => x.k === k) || {}).l || k;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 14px 80px" }}>
      <AdminNav current="reports" />
      <p className="f-sans" style={{ fontSize: 12, color: "#717171", lineHeight: 1.7, margin: "0 0 12px" }}>
        利用者からの報告（求人・チャットのコメント・人・画面）をここに集約しています。対応済みは表示していません（記録は残ります）。
      </p>
      {/* ジャンルの絞り込みピル（システムページの重要度ピルと同じ視覚文法・0件も押せる） */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", WebkitOverflowScrolling: "touch", padding: "2px 2px 4px", marginBottom: 14 }}>
        {KINDS.map(g => {
          const active = kind === g.k;
          return (
            <button key={g.k} type="button" onClick={() => setKind(g.k)} className="f-sans" style={{
              flexShrink: 0, padding: "7px 13px", borderRadius: 20, whiteSpace: "nowrap", fontSize: 12, cursor: "pointer",
              border: active ? "2px solid #222" : "2px solid #EBEBEB", fontWeight: active ? 700 : 600,
              background: "#fff", color: active ? "#222" : "#717171",
            }}>{g.l}{items !== null ? `（${countOf(g.k)}）` : ""}</button>
          );
        })}
      </div>
      {list === null ? (
        <p className="f-sans" style={{ textAlign: "center", color: "#999", fontSize: 13, padding: "40px 0" }}>読み込み中<Dots /></p>
      ) : list.length === 0 ? (
        <p className="f-sans" style={{ textAlign: "center", color: "#999", fontSize: 13, padding: "40px 0" }}>
          {kind === "all" ? "未対応の報告はありません" : `「${kindLabel(kind)}」の未対応の報告はありません`}
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {list.map(r => (
            <div key={r.kind + r.id} style={cardStyle}>
              {/* 見出し行：ジャンルチップ＋要点＋時刻 */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span className="f-sans" style={chipStyle}>{kindLabel(r.kind)}</span>
                <p className="f-sans" style={{ fontSize: 14, fontWeight: 700, color: r.kind === "screen" ? "#222" : "#E24B4A", margin: 0, flex: 1, minWidth: 0 }}>
                  {r.kind === "job" && <>求人 #{r.job_number}　{r.issue_type}</>}
                  {r.kind === "comment" && r.reason}
                  {r.kind === "person" && r.issue_type}
                  {r.kind === "screen" && (FB_LABEL[r.category] || r.category)}
                </p>
                <span className="f-sans" style={timeStyle}>{r.created_at ? new Date(r.created_at).toLocaleString("ja-JP") : ""}</span>
              </div>
              {/* 中身：台帳ごとの事実（旧AdminTab通報節と同じ項目） */}
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
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                {r.kind === "job" && (
                  <button onClick={() => { window.location.hash = "/admin/review/" + r.job_number; }} className="f-sans" style={linkBtn}>求人を見る</button>
                )}
                {r.kind === "person" && (
                  <button onClick={() => openWorkerPreview(r.target_worker_id)} className="f-sans" style={linkBtn}>働き手を見る</button>
                )}
                <button onClick={() => resolve(r)} disabled={busy === r.id} className="f-sans" style={{ ...resolveBtn, opacity: busy === r.id ? 0.6 : 1 }}>対応済みにする</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
