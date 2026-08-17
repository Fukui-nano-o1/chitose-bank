// 🕐 打刻の修正申請シート（第13弾(2)・共通部品・2026-07-30たきと指示「申請権の非対称を解消」）
// 働き手・雇い手のどちらからも同じシートで申請する。申請＝相手の承認で成立ので、
// どちらから出しても双方署名の構造は崩れない（片方が勝手に記録を書き換えられるわけではない）。
// 申請と結果は attendance_corrections に残る＝記録の憲法（アクションは必ず記録に残す）。
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { ymdLocal } from "../lib/utils";

// app: applications の行（id・started_at・work_completed_at を使う）
// baseYmd: "HH:MM" を実時刻に戻すときの日付。省略時は開始打刻の日→今日の順に決める
export function TimeCorrectionSheet({ app, baseYmd, onClose }) {
  const hm = (ts) => { if (!ts) return ""; const d = new Date(ts); return String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0"); };
  const [start, setStart] = useState(hm(app?.started_at));   // "HH:MM"（空＝変更なし）
  const [end, setEnd] = useState(hm(app?.work_completed_at));
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  if (!app) return null;
  // "HH:MM" を作業日のその時刻（端末のタイムゾーン）としてISOに戻す
  const toIso = (v) => {
    if (!v) return null;
    const base = baseYmd || (app.started_at ? ymdLocal(new Date(app.started_at)) : ymdLocal(new Date()));
    const [h, mi] = v.split(":").map(n => parseInt(n, 10));
    const d = new Date(base + "T00:00:00");
    d.setHours(h, mi, 0, 0);
    return d.toISOString();
  };
  const submit = async () => {
    if (sending) return;
    if (!start && !end) { alert("開始時刻か終了時刻のどちらかを入れてください"); return; }
    setSending(true);
    try {
      // 重複申請はDB側が弾き message を返すので、それをそのまま出す
      const { data, error } = await supabase.rpc("request_time_correction", {
        p_application_id: app.id,
        p_started: toIso(start),
        p_ended: toIso(end),
        p_reason: reason.trim(),
      });
      if (error) { alert("送信に失敗しました：" + error.message); setSending(false); return; }
      if (!data?.ok) { alert(data?.message || ("送信できませんでした：" + (data?.reason || "不明"))); setSending(false); return; }
      onClose();
      alert("修正の申請を送りました。相手の承認をお待ちください。");
    } catch (e) { alert("送信に失敗しました：" + (e?.message || "不明")); }
    setSending(false);
  };
  return (
    <div className="cb-lock-scroll" style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      {/* maxHeight+内側スクロール＝画面の低い環境（SafariのURLバー・下部バーあり／小さい端末）で
          シートが上下に見切れないため（2026-08-16たきと報告「枠外に出ている」。PWAの広い画面では
          収まっていたがSafari約600ptでは中身約630ptがはみ出していた）。中央ボックス規格の標準形 */}
      <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"100%", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:6 }}>🕐 打刻の修正を申請</p>
        <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.6, marginBottom:14 }}>
          実際の時刻を入れてください。どちらか片方だけでも申請できます。
        </p>
        {/* ★minWidth:0（グリッドの子）＋maxWidth:100%（入力）＝枠外へはみ出さない（2026-08-16たきと報告）。
            グリッドの子は既定が min-width:auto ので、iOSの input[type=time] の固有幅
            （モバイルは font-size:16px 強制＋.field の左右パディング16px）がトラック幅を超えると
            縮まずに右へはみ出す。grid の外にある textarea thaが収まっていたのはこのため */}
        <div style={{ display:"grid", gap:10, marginBottom:14 }}>
          <label className="f-sans" style={{ fontSize:12, color:"#717171", minWidth:0 }}>開始時刻
            <input type="time" value={start} onChange={e=>setStart(e.target.value)}
              className="field f-sans" style={{ width:"100%", maxWidth:"100%", minWidth:0, fontSize:16, marginTop:4, marginBottom:0 }} />
          </label>
          <label className="f-sans" style={{ fontSize:12, color:"#717171", minWidth:0 }}>終了時刻
            <input type="time" value={end} onChange={e=>setEnd(e.target.value)}
              className="field f-sans" style={{ width:"100%", maxWidth:"100%", minWidth:0, fontSize:16, marginTop:4, marginBottom:0 }} />
          </label>
        </div>
        <textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="理由（任意）" rows={3}
          className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:14, marginBottom:12, boxSizing:"border-box", resize:"vertical" }} />
        <p className="f-sans" style={{ fontSize:11, color:"#717171", lineHeight:1.6, marginBottom:14, background:"#F7F7F7", borderRadius:8, padding:"8px 10px" }}>
          相手の承認で記録が修正されます。申請と結果は記録に残ります。
        </p>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onClose} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#F7F7F7", border:"none", borderRadius:8, cursor:"pointer" }}>やめる</button>
          <button onClick={submit} disabled={sending || (!start && !end)}
            className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", opacity:(sending || (!start && !end)) ? 0.5 : 1 }}>
            {sending ? "送信中..." : "申請する"}
          </button>
        </div>
      </div>
    </div>
  );
}
