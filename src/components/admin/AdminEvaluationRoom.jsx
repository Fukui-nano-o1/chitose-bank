// 客観的評価ページ（#/admin/evaluation・管理者専用・2026-08-05）。
// まずは管理画面として作る（たきと指示）。タイトルは置かない＝カードだけを並べる。
//
// 【このページの原則】評価は2つの層だけで組み立てる。運営の主観は一切混ぜない（2026-07-16あっせん回避）。
//   ① 記録から導出した事実 … 打刻・操作の時刻そのもの（誰の意見でもない）
//   ② 当事者が申告した事実 … reviews のはい/いいえのみ
//   自由記述（働きぶり・本人だけのメモ）は載せない。点数・順位・おすすめ度も作らない
//   （reviews v1 の思想＝ランキング・スコア・レコメンドには使わない＝事実の陳列まで）。
// 読み取り専用（admin_evaluation_records RPC・security definer + app_admins ゲート）。書き込みは無し。
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { dateRangeLabel } from "../../lib/utils";
import { getCache, setCache } from "../../lib/viewCache";
import { Dots } from "../ui";
import { AdminNav } from "./AdminNav";

// 作業日程：agreed_dates（当事者が合意した実施日）があればそれ、無ければ求人の日程
function scheduleLabel(item) {
  const ad = item.agreed_dates;
  if (Array.isArray(ad) && ad.length) {
    const sorted = [...ad].map(String).sort();
    return dateRangeLabel(sorted[0], sorted[sorted.length - 1]);
  }
  if (item.date_start) return dateRangeLabel(item.date_start, item.date_end);
  return item.date_label || "日程未設定";
}

const PHASE = {
  completed: { label: "完了", color: "#00897B" },
  working:   { label: "作業中", color: "#E24B4A" },
};
const phaseOf = (item) => PHASE[item.status] || { label: "採用", color: "#1E88E5" };

// 記録の1行（時刻があれば緑✓＋時刻、無ければグレー「未」）。AdminWorkingRoom と同じ意匠
function FactRow({ label, at, note }) {
  const done = !!at;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
      <span style={{ width:18, height:18, borderRadius:"50%", flexShrink:0, display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800,
        background: done ? "#00A86B" : "#F0F0F0", color: done ? "#fff" : "#C8C8C8" }}>{done ? "✓" : ""}</span>
      <span className="f-sans" style={{ color:"#717171", width:104, flexShrink:0 }}>{label}</span>
      <span className="f-sans" style={{ color: done ? "#222" : "#B0B0B0", fontWeight: done ? 600 : 400 }}>{done ? at : "未"}</span>
      {done && note && <span className="f-sans" style={{ fontSize:10, fontWeight:700, color:"#8A6D3B", background:"#FCF3DC", borderRadius:20, padding:"1px 7px" }}>{note}</span>}
    </div>
  );
}

// 当事者が申告した事実の1行。はい/いいえ/ー（未記入）をそのまま出す＝点数化しない
function AxisRow({ label, value }) {
  const t = value === true ? "はい" : value === false ? "いいえ" : "ー";
  const c = value === true ? "#00A86B" : value === false ? "#E24B4A" : "#B0B0B0";
  return (
    <div className="f-sans" style={{ display:"flex", alignItems:"baseline", gap:8, fontSize:12 }}>
      <span style={{ color:"#717171", flex:1, minWidth:0 }}>{label}</span>
      <span style={{ color:c, fontWeight:700, flexShrink:0 }}>{t}</span>
    </div>
  );
}

// 片方向ぶんの申告（未提出なら「未提出」とだけ出す＝空欄で誤読させない）
function ReviewBlock({ title, review, axes }) {
  return (
    <div style={{ flex:"1 1 200px", minWidth:0, background:"#fff", border:"1px solid #F0F0F0", borderRadius:10, padding:"10px 12px" }}>
      <p className="f-sans" style={{ fontSize:11, fontWeight:800, color:"#222", margin:"0 0 6px" }}>{title}</p>
      {!review ? (
        <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", margin:0 }}>未提出</p>
      ) : (<>
        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
          {axes.map(a => <AxisRow key={a.k} label={a.l} value={review[a.k]} />)}
        </div>
        <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"6px 0 0" }}>{review.at}</p>
      </>)}
    </div>
  );
}

const F2W_AXES = [
  { k:"on_time",               l:"時間どおりに来た" },
  { k:"as_described",          l:"打合せどおりだった" },
  { k:"followed_instructions", l:"指示・安全に従えた" },
  { k:"completed_work",        l:"最後までやり切った" },
  { k:"entrust",               l:"安心して任せられた" },
  { k:"want_again",            l:"また呼びたい" },
];
const W2F_AXES = [
  { k:"on_time",        l:"時間どおりに始まった" },
  { k:"as_described",   l:"求人内容どおりだった" },
  { k:"safety_care",    l:"安全に配慮された" },
  { k:"completed_work", l:"報酬が約束どおり支払われた" },
  { k:"want_again",     l:"また働きたい" },
];

function workedLabel(min) {
  if (min == null) return null;
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}時間${m ? m + "分" : ""}` : `${m}分`;
}

function EvalCard({ item }) {
  const phase = phaseOf(item);
  const worked = workedLabel(item.worked_minutes);
  return (
    <div className="ledger-card" style={{ padding:"14px 16px", marginBottom:12, borderLeft:`3px solid ${phase.color}` }}>
      {/* 見出し行：作物・作業／地域／求人No. */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:8 }}>
        <div style={{ minWidth:0 }}>
          <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.crop || "作物未設定"}　{item.task || ""}</p>
          <p className="f-sans" style={{ fontSize:11, color:"#999", margin:"2px 0 0" }}>{[item.prefecture, item.city].filter(Boolean).join(" ") || "地域未設定"}</p>
        </div>
        <a href={`#/work/job/${item.job_number}`} className="f-sans" style={{ flexShrink:0, textDecoration:"none", fontSize:11, fontWeight:700, color:"#00A86B", background:"#E6F7EF", borderRadius:8, padding:"4px 10px" }}>No.{item.job_number} ↗</a>
      </div>

      <div className="f-sans" style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:"#222", flexWrap:"wrap" }}>
        <span style={{ fontWeight:700 }}>{item.worker_name || "働き手"}</span>
        <span style={{ color:"#B0B0B0" }}>働き手</span>
        <span style={{ color:"#C8C8C8", margin:"0 2px" }}>⇄</span>
        <span style={{ fontWeight:700 }}>{item.farmer_name || "農家"}</span>
        <span style={{ color:"#B0B0B0" }}>農家</span>
      </div>

      <p className="f-sans" style={{ fontSize:12, color:"#444", margin:"8px 0 10px", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        <span>{scheduleLabel(item)}</span>
        <span style={{ fontSize:10, fontWeight:800, color:"#fff", background:phase.color, borderRadius:20, padding:"2px 8px" }}>{phase.label}</span>
        {item.attended === false && <span style={{ fontSize:10, fontWeight:800, color:"#fff", background:"#E24B4A", borderRadius:20, padding:"2px 8px" }}>欠席</span>}
        {worked && <span style={{ color:"#717171" }}>· 実働 {worked}</span>}
      </p>

      {/* ① 記録から導出した事実 */}
      <p className="f-sans" style={{ fontSize:11, fontWeight:800, color:"#717171", margin:"0 0 6px" }}>記録</p>
      <div style={{ display:"flex", flexDirection:"column", gap:6, background:"#FAFAFA", borderRadius:10, padding:"10px 12px" }}>
        <FactRow label="採用" at={item.hired_at} />
        <FactRow label="保険の準備" at={item.insurance_prepared_at} />
        <FactRow label="開始（働き手）" at={item.started_at}
          note={item.auto_started ? "自動開始" : item.started_declared ? "申告" : item.time_corrected ? "修正あり" : null} />
        <FactRow label="開始確認（農家）" at={item.farmer_confirmed_start_at} />
        <FactRow label="完了（農家）" at={item.work_completed_at}
          note={item.auto_completed ? "自動完了" : item.ended_declared ? "申告" : null} />
        <FactRow label="終了確認（働き手）" at={item.worker_confirmed_end_at} />
      </div>

      {/* ② 当事者が申告した事実（はい/いいえのみ・自由記述は載せない） */}
      <p className="f-sans" style={{ fontSize:11, fontWeight:800, color:"#717171", margin:"12px 0 6px" }}>当事者の申告</p>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        <ReviewBlock title="農家 → 働き手" review={item.review_f2w} axes={F2W_AXES} />
        <ReviewBlock title="働き手 → 農家" review={item.review_w2f} axes={W2F_AXES} />
      </div>
    </div>
  );
}

export function AdminEvaluationRoom() {
  // 前回結果があれば即描画し、裏で最新に差し替える（2026-08-02・更新時間の短縮の作法）
  const [state, setState] = useState(() => {
    const d = getCache("admin:evaluationRecords");
    return d?.ok ? { records: d.records || [] } : null;
  }); // null=読み込み中 | {records} | "error" | "denied"
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_evaluation_records");
    // 裏の再取得が失敗しても、キャッシュ表示中ならそのまま保つ（エラー画面で上書きしない）
    if (error) { setState(prev => (prev && typeof prev === "object") ? prev : "error"); return; }
    if (!data?.ok) { setState(data?.reason === "not_admin" ? "denied" : "error"); return; }
    setCache("admin:evaluationRecords", data);
    setState({ records: data.records || [] });
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="appear" style={{ maxWidth:640, margin:"0 auto", padding:"20px 16px 120px" }}>
      <AdminNav current="evaluation" />

      {state === null && (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>読み込み中<Dots /></p>
      )}
      {state === "denied" && (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>管理者のみが閲覧できます</p>
      )}
      {state === "error" && (
        <p className="f-sans" style={{ textAlign:"center", color:"#E24B4A", fontSize:13, padding:"48px 0" }}>読み込みに失敗しました。ページを開き直してください</p>
      )}

      {state && typeof state === "object" && (
        state.records.length === 0 ? (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>採用に至ったマッチがまだありません</p>
        ) : (<>
          {state.records.map(item => <EvalCard key={item.application_id} item={item} />)}
          <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, margin:"18px 2px 0" }}>
            記録＝打刻と操作の時刻そのもの。当事者の申告＝はい/いいえのみ。
            自由記述（働きぶり・本人だけのメモ）は表示しません。点数・順位は付けません。
          </p>
        </>)
      )}
    </div>
  );
}
