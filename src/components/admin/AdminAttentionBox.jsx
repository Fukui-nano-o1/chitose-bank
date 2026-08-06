// 運営の気づきボックス（2026-08-06たきと指示「通知ボックスを設置。管理者権限者のみが見れるように。
// ハンバーガーメニューの上部に設置。ハンバーガーメニューと同じ展開や非表示を演出。それだけ」）。
//
// ■【読み取り専用】admin_attention() を呼んで並べるだけ。ここからDBへの書き込みは一切しない
//   （「対処済みにする」等の更新は将来の別工事。保存・入力の管理者ゲートの論点には非該当）。
// ■権限はサーバーが持つ：admin_attention は app_admins ゲート付き SECURITY DEFINER で、
//   未ログイン(anon)はEXECUTE不可・一般ユーザーは not_admin。画面の isAdmin は見た目の出し分けだけ。
// ■2レーン（性質が逆so混ぜない）：
//   ①直すこと   ＝運営が手を動かすまで消えない（不具合・通報・退会依頼・意見）
//   ②動いていないこと＝当事者が動けば自動で消える（取引の滞留）。件数と経過日数だけを出す
// ■運営の主観は入れない：点数・おすすめ度・優先順位の重みづけを作らない（2026-07-16の規律）。
//   並びは固定、目印は経過日数だけ。
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { getCache, setCache } from "../../lib/viewCache";
import { fmtJstShort } from "../../lib/utils";
import { Dots } from "../ui";

// 滞留の行（レーン②）。行き先があるものだけリンクにする＝行き先の無いボタンを作らない
const STALL_ROWS = [
  { k:"applied",           icon:"📨", label:"未判断の応募" },
  { k:"pending_jobs",      icon:"📋", label:"審査待ちの求人",     to:"/admin" },
  { k:"revision",          icon:"📝", label:"修正のお願い中の求人", to:"/admin" },
  { k:"questions",         icon:"💬", label:"未回答の質問" },
  { k:"corrections",       icon:"🕐", label:"未処理の打刻修正" },
  { k:"start_unconfirmed", icon:"✓",  label:"開始の確認待ち",     to:"/admin/working" },
  { k:"complete_missing",  icon:"✅", label:"作業日を過ぎて完了記録なし", to:"/admin/working" },
  { k:"emergency_7d",      icon:"⚠️", label:"緊急連絡（7日以内）", to:"/admin/working" },
];

export function AdminAttentionBox({ open, onToggle }) {
  // 前回内容があれば即描画→裏で最新に差し替える（viewCacheのSWR・他ページと同じ作法）
  const [data, setData] = useState(() => getCache("admin:attention") ?? null);
  const [err, setErr] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data: res, error } = await supabase.rpc("admin_attention");
      if (error || !res?.ok) { setErr(true); return; }
      setErr(false); setData(res); setCache("admin:attention", res);
    } catch { setErr(true); }
  }, []);
  useEffect(() => { load(); }, [load]);            // 起動時に1回（バッジを出すため）
  useEffect(() => { if (open) load(); }, [open, load]); // 開くたびに取り直す

  const fix = data?.fix, stall = data?.stall;
  // バッジ＝運営が手を動かす側（レーン①）の件数だけ。滞留は当事者の番so数に入れない
  // （鳴りすぎると読まなくなる＝cron_watchdogの誤報抑制で学んだこと）
  const fixCount = fix ? (fix.error_total || 0) + (fix.reports_message || 0) + (fix.reports_job || 0)
    + (fix.reports_profile || 0) + (fix.withdrawals || 0) : 0;
  const go = (hash) => { onToggle(false); window.location.hash = hash; };

  return (
    <>
      <button onClick={(e)=>{ e.stopPropagation(); onToggle(!open); }} aria-label="運営の気づき"
        className={"app-header-mobile-float-btn cb-notice-fab-btn" + (open ? " active" : "")}>
        <span className="icon">🔔</span>
        {fixCount > 0 && <span className="cb-notice-badge f-sans">{fixCount > 99 ? "99+" : fixCount}</span>}
      </button>
      {open && (
        <div className="cb-notice-panel" onClick={(e)=>e.stopPropagation()}>
          {!data ? (
            <p className="f-sans" style={{ fontSize:12, color:"#999", textAlign:"center", padding:"18px 0", margin:0 }}>
              {err ? "読み込めませんでした" : <>読み込み中<Dots /></>}
            </p>
          ) : (
            <>
              {/* ── レーン①：直すこと ── */}
              <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 6px", padding:"0 14px" }}>直すこと</p>
              <div style={{ padding:"0 14px 10px", display:"grid", gap:8 }}>
                {(fix.errors || []).length === 0 ? (
                  <p className="f-sans" style={{ fontSize:12, color:"#999", margin:0 }}>未対処の不具合はありません</p>
                ) : (fix.errors || []).map((e, i) => (
                  /* 同じ原因は束ねてある（部品×文言）＝生ログを並べない。上位8件・新しい順 */
                  <div key={i} style={{ background:"#FFF6F6", border:"1px solid #F3D3D3", borderRadius:10, padding:"8px 10px" }}>
                    <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#222", margin:0, lineHeight:1.5, wordBreak:"break-word" }}>{e.message}</p>
                    <p className="f-sans" style={{ fontSize:11, color:"#999", margin:"3px 0 0" }}>
                      {e.component}　{e.cnt}件　最後は {fmtJstShort(e.latest)}{e.page ? "　" + e.page : ""}
                    </p>
                  </div>
                ))}
                {fix.error_total > 0 && (
                  <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:0 }}>未対処の記録は全部で {fix.error_total} 件</p>
                )}
                {[["通報（メッセージ）", fix.reports_message], ["通報（求人）", fix.reports_job], ["通報（プロフィール）", fix.reports_profile],
                  ["退会の依頼", fix.withdrawals], ["届いた意見（7日以内）", fix.feedback_7d]]
                  .filter(r => r[1] > 0).map(r => (
                    <p key={r[0]} className="f-sans" style={{ fontSize:12, color:"#222", margin:0 }}>{r[0]}　<b>{r[1]}</b> 件</p>
                  ))}
              </div>
              {/* ── レーン②：動いていないこと ── */}
              <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"4px 0 6px", padding:"0 14px", borderTop:"1px solid #F0F0F0", paddingTop:10 }}>動いていないこと</p>
              <div style={{ padding:"0 6px 4px" }}>
                {STALL_ROWS.map(r => {
                  const v = stall?.[r.k] || { n:0, days:null };
                  const dim = !v.n;
                  const body = (
                    <>
                      <span style={{ flexShrink:0, width:20, textAlign:"center" }}>{r.icon}</span>
                      <span className="f-sans" style={{ flex:1, minWidth:0, fontSize:13, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.label}</span>
                      {/* 「いちばん古いものが何日前か」＝優先度は経過時間が決める（運営の点数を付けない） */}
                      {v.days != null && v.n > 0 && <span className="f-sans" style={{ flexShrink:0, fontSize:11, color:"#999" }}>{v.days}日</span>}
                      <span className="f-sans" style={{ flexShrink:0, fontSize:13, fontWeight:800, color: v.n ? "#222" : "#C8C8C8", minWidth:22, textAlign:"right" }}>{v.n}</span>
                    </>
                  );
                  const style = { display:"flex", alignItems:"center", gap:8, width:"100%", textAlign:"left",
                    background:"none", border:"none", padding:"9px 10px", opacity: dim ? 0.45 : 1 };
                  return r.to && v.n > 0
                    ? <button key={r.k} onClick={()=>go(r.to)} className="f-sans" style={{ ...style, cursor:"pointer" }}>{body}</button>
                    : <div key={r.k} style={style}>{body}</div>;
                })}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
