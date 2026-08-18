// 働き手ダッシュボード（#/admin/evaluation・2026-08-05たきと指示）。
// 用途：農家が働き手を確認するときに一番見るページ。運営の見守り用ではない。
//   ① 直近5件に遅刻・欠勤はあるか ② 労働の総件数・総時間 ③ 作物別・作業別の件数と時間
//
// 【見える範囲】一覧（誰がいるか）は運営のみ＝admin_worker_list。求職者の名簿ので農家には開かない。
//   1人ぶんの記録は、その働き手から応募を受けた農家にも開いた（2026-08-05たきと指示・関係ゲート）。
//   農家の入口は働き手プレビューの2枚目＝このページと同じ部品（WorkerWorkRecord）を使う。
//
// 【この画面が言わないこと】点数・順位・おすすめ度は作らない。良し悪しの断定もしない。
//   出すのは記録そのもの（出欠・求人の勤務時間）だけ。運営の主観は混ぜない（2026-07-16）。
//   遅刻の判定は持たない（2026-08-18「打刻の全面削除」）＝開始時刻は自動で入るため。
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { getCache, setCache } from "../../lib/viewCache";
import { Dots } from "../ui";
import { WorkerWorkRecord, workRecordMinutesLabel as hm } from "../WorkerWorkRecord";
import { AdminNav } from "./AdminNav";

// URLから働き手を読む（#/admin/evaluation/{worker_id}）。無ければ一覧
function readWorkerId() {
  try {
    const h = window.location.hash.replace(/^#\/?/, "");
    const m = h.match(/^admin\/evaluation\/([0-9a-f-]{36})$/i);
    return m ? m[1] : null;
  } catch { return null; }
}

export function AdminEvaluationRoom() {
  const [workerId, setWorkerId] = useState(readWorkerId);
  useEffect(() => {
    const onHash = () => setWorkerId(readWorkerId());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // このページが自分で読むのは【働き手の一覧】だけ（admin_worker_list＝求職者の名簿ので運営のみ）。
  // 1人ぶんの記録は WorkerWorkRecord が読む（worker_work_record＝本人・関係のある農家・運営）
  // （ダッシュボードとプレビューで同じ部品＝取得も表示も1箇所）。
  // 前回結果があれば即描画し、裏で最新に差し替える（2026-08-02・更新時間の短縮の作法）
  const [state, setState] = useState(() => {
    const d = getCache("admin:workerList");
    return d?.ok ? d : null;
  }); // null=読み込み中 | データ | "error" | "denied"
  const load = useCallback(async () => {
    if (workerId) return; // 1人ぶんを開いている間は一覧を取り直さない（二重の往復を作らない）
    const { data, error } = await supabase.rpc("admin_worker_list");
    // 裏の再取得が失敗しても、キャッシュ表示中ならそのまま保つ（エラー画面で上書きしない）
    if (error) { setState(prev => (prev && typeof prev === "object") ? prev : "error"); return; }
    if (!data?.ok) { setState(data?.reason === "not_admin" ? "denied" : "error"); return; }
    setCache("admin:workerList", data);
    setState(data);
  }, [workerId]);
  useEffect(() => { load(); }, [load]);

  return (
    /* cb-admin-page＝サイトフッターを隠す目印（下部バー・浮遊☰は出す・appStyles・2026-08-05） */
    <div className="appear cb-admin-page" style={{ maxWidth:640, margin:"0 auto", padding:"20px 16px", paddingBottom:"calc(140px + env(safe-area-inset-bottom, 0px))" }}>
      <AdminNav current="evaluation" />

      {workerId && (
        <button type="button" className="f-sans" onClick={() => { window.location.hash = "/admin/evaluation"; }}
          style={{ background:"none", border:"none", padding:"0 0 12px", color:"#717171", fontSize:12, fontWeight:700, cursor:"pointer" }}>← 働き手の一覧</button>
      )}

      {!workerId && state === null && (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>読み込み中<Dots /></p>
      )}
      {!workerId && state === "denied" && (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>管理者のみが閲覧できます</p>
      )}
      {!workerId && state === "error" && (
        <p className="f-sans" style={{ textAlign:"center", color:"#E24B4A", fontSize:13, padding:"48px 0" }}>読み込みに失敗しました。ページを開き直してください</p>
      )}

      {/* 一覧：働き手を選ぶ（農家に出すときは、この一覧は要らず1人ぶんを直接開く） */}
      {state && typeof state === "object" && !workerId && (
        (state.workers || []).length === 0 ? (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>働いた記録のある働き手がまだいません</p>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {state.workers.map(w => (
              <button key={w.worker_id} type="button" className="ledger-card f-sans"
                onClick={() => { window.location.hash = "/admin/evaluation/" + w.worker_id; }}
                style={{ textAlign:"left", border:"none", cursor:"pointer", padding:"14px 16px", display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ flex:1, minWidth:0, fontSize:14, fontWeight:800, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{w.name || "名前未設定"}</span>
                <span style={{ flexShrink:0, fontSize:12, color:"#717171" }}>{w.completed_count}件 · {hm(w.total_minutes)}</span>
                {w.absent_count > 0 && <span style={{ flexShrink:0, fontSize:11, fontWeight:800, color:"#E24B4A", background:"#FDECEC", borderRadius:20, padding:"3px 8px" }}>欠勤{w.absent_count}</span>}
              </button>
            ))}
          </div>
        )
      )}

      {workerId && <WorkerWorkRecord workerId={workerId} showName />}
    </div>
  );
}
