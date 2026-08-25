// マイページの「つぎの予定（7日以内）」。
// 経緯：2026-08-22たきと指示で今日ページのカード群をマイページへ移し、そのまま今日ページ本体を廃止
//   （つぎの予定もこの時に移植）。2026-08-25「やること必要なくなったな。他のページに移設したりしたから。削除」
//   ＝やることの格子は撤去し、この部品はつぎの予定だけを描く。
// ★消えた行為の入口（移設先）：採用する／保険の報告／記録する／評価する・緊急連絡先＝カレンダーページの
//   求人カードのボタン。求人の修正・求人の質問＝求人カード（❓バッジ）とお知らせ・メールのリンク。
//   プロフィール入力＝名刺カードの「編集する」（未入力の数バッジつき）。
//   用件の専用ページ（#/calendar/todo/{stage}）は今日ページ側に残っている＝リンクはそのまま生きている。
// データ源・viewCacheの鍵（today:entries）は今日ページの専用ページ・カレンダーと共用＝
//   どれを先に開いても前回内容で即描画され、裏で最新に差し替わる（SWR）。
import { useState, useEffect } from "react";
import { getCache, setCache } from "../../../lib/viewCache";
import { useRefreshTick, REFRESH_APPLICATIONS } from "../../../lib/refreshBus";
import { ymdLocal, calAddDays, calFmtDate, ROLE_ORANGE, ROLE_GREEN } from "../../../lib/utils";
import { getSession, fetchMyCalendarJobs } from "../todayApi";
import { NavIconInline } from "../../../components/NavIcons";

export function UpcomingSchedule({ role = "worker" }) {
  // 応募の変化(Realtime)・画面の復帰で取り直す（今日ページと同じ合図・2026-08-18 Speed-1B）
  const refreshTick = useRefreshTick(REFRESH_APPLICATIONS);
  const [entries, setEntries] = useState(() => getCache("today:entries") ?? []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await getSession();
        if (!session) return;
        const { data, error } = await fetchMyCalendarJobs();
        // 失敗したら手元の値を上書きしない（2026-08-07規則＝一瞬「予定なし」に見せない）
        if (cancelled || error) return;
        const rows = data || [];
        setEntries(rows); setCache("today:entries", rows);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [refreshTick]);

  // つぎの予定（7日以内）＝旧・今日ページ本体からの移植。導出・並び・行の見た目は原本のまま。
  // 行タップで求人ページへ（戻り先＝この面）
  const todayYmd = ymdLocal(new Date());
  const in7Ymd = ymdLocal(calAddDays(7));
  const upcoming = entries
    .filter(e => e.my_role === role && e.relation === "application")
    .filter(e => e.date_start && e.date_start > todayYmd && e.date_start <= in7Ymd)
    .sort((a, b) => (a.date_start || "").localeCompare(b.date_start || "") || (a.work_time || "").localeCompare(b.work_time || ""));
  if (upcoming.length === 0) return null;

  const accent = role === "worker" ? ROLE_ORANGE : ROLE_GREEN;
  const backHash = role === "farmer" ? "/profile/employer" : "/profile";

  return (
    <div style={{ marginTop:16 }}>
      <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 8px", borderLeft:"3px solid #DDD", paddingLeft:8 }}>つぎの予定（7日以内）</p>
      <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr)", gap:8 }}>
        {upcoming.map(e => {
          const label = e.date_end && e.date_end !== e.date_start ? `${calFmtDate(e.date_start)}〜${calFmtDate(e.date_end)}` : calFmtDate(e.date_start);
          return (
            <button key={e.application_id || e.job_number}
              onClick={()=>{ try { sessionStorage.setItem("cb_jobBackTo", backHash); } catch {} window.location.hash = "/work/job/" + e.job_number; }}
              className="f-sans" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, width:"100%", textAlign:"left", background:"#fff", border:"1px solid #F0F0F0", borderLeft:"3px solid " + accent, borderRadius:10, padding:"11px 12px", cursor:"pointer" }}>
              <span style={{ minWidth:0, overflow:"hidden" }}>
                <span style={{ display:"block", fontSize:13, fontWeight:600, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[e.crop, e.task].filter(Boolean).join(" ") || "求人"} <span style={{ color:"#999", fontWeight:700, fontSize:11 }}>#{e.job_number}</span></span>
                <span style={{ display:"block", fontSize:11, color:"#999", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}><NavIconInline name="calendar" size={11} style={{ verticalAlign:"-1px", marginRight:3 }} />{label}{e.work_time ? "　" + e.work_time : ""}{role === "farmer" && e.partner_name ? "　" + e.partner_name : ""}</span>
              </span>
              <span style={{ color:"#C8C8C8", fontSize:16, flexShrink:0 }}>›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
