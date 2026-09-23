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
import { calFmtDate, ROLE_ORANGE, ROLE_GREEN, APP_PHASE_LABEL } from "../../../lib/utils";
import { useScheduleEntries } from "../useScheduleEntries";
import { schedulePath, schedulePhase, upcomingSchedules } from "../schedule";
import { NavIconInline } from "../../../components/NavIcons";

export function UpcomingSchedule({ role = "worker" }) {
  const { entries } = useScheduleEntries();
  const upcoming = upcomingSchedules(entries, role);
  if (upcoming.length === 0) return null;

  const accent = role === "worker" ? ROLE_ORANGE : ROLE_GREEN;

  return (
    <div style={{ marginTop:16 }}>
      <p className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:"0 0 12px" }}>つぎの予定</p>
      <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr)", gap:8 }}>
        {upcoming.map(e => {
          const label = calFmtDate(e.next_date);
          return (
            <button key={e.application_id} data-prefetch-route={schedulePath(role, e.application_id)}
              onClick={()=>{ window.location.hash = schedulePath(role, e.application_id); }}
              className="f-sans" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, width:"100%", textAlign:"left", background:"#fff", border:"1px solid #F0F0F0", borderLeft:"3px solid " + accent, borderRadius:10, padding:"11px 12px", cursor:"pointer" }}>
              <span style={{ minWidth:0, overflow:"hidden" }}>
                <span style={{ display:"block", fontSize:13, fontWeight:600, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[e.crop, e.task].filter(Boolean).join(" ") || "求人"} <span style={{ color:"#999", fontWeight:700, fontSize:11 }}>#{e.job_number}</span></span>
                <span style={{ display:"block", fontSize:11, color:"#717171", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}><NavIconInline name="calendar" size={11} style={{ verticalAlign:"-1px", marginRight:3 }} />{label}{e.work_time ? "　" + e.work_time : ""}{e.partner_name ? "　" + e.partner_name : ""}</span>
                <span style={{ display:"block", fontSize:11, color:accent, marginTop:4 }}>{APP_PHASE_LABEL[schedulePhase(e)]}</span>
              </span>
              <span style={{ color:"#C8C8C8", fontSize:16, flexShrink:0 }}>›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
