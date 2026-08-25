// マイページのやることカード群（2026-08-22たきと指示「今日ページのカード群をマイページの
// いいねした求人カードの下にコピー。実機確認後、今日ページの削除に移行する」）。
// ★移行中の複製：正本は components/TodayPage.jsx（TODO_META・TODO_STAGE_CATALOG・TodoStageBox）。
//   並び・行き先はそちらと揃えること（変えるときは両方）。
//   ただし【絵柄とラベルは features/today/boxFace.js に集約済み】＝そこを直せば両方に効く
//   （2026-08-22：アイコン差し替えで正本だけ直し、この複製が絵文字のまま残った事故の再発防止）。
//   箱の行き先（#/calendar/todo/{stage} の専用ページ）は今日ページ側に残っている＝リンクはそのまま。
//   今日ページを削除する時は、専用ページごとこちら側へ引っ越して唯一の実装にする。
// データ源・viewCacheの鍵は今日ページと完全に共用（today:entries/todos/unset/hired）＝
//   どちらを先に開いても前回内容で即描画され、裏で最新に差し替わる（SWR）。
import { useState, useEffect } from "react";
import { getCache, setCache } from "../../../lib/viewCache";
import { useRefreshTick, REFRESH_APPLICATIONS } from "../../../lib/refreshBus";
import { ymdLocal, calAddDays, calFmtDate, entryWorkDays, ROLE_ORANGE, ROLE_GREEN,
  workerUnsetCount, employerUnsetCount, WORKER_UNSET_COLUMNS, EMPLOYER_UNSET_COLUMNS } from "../../../lib/utils";
import { getSession, fetchMyCalendarJobs, fetchMyTodoItems, fetchMyWorkerProfile,
  fetchMyEmployerProfile, fetchMyEmergencyContact, fetchMyApplicationTerms } from "../todayApi";
import { NavIcon, NavIconInline } from "../../../components/NavIcons";
import { BOX_FACE, BOX_ICON_SIZE } from "../boxFace";

// 今日ページから箱を消した用件（TodayPage の REMOVED_STAGES の写し・対で管理）
// ★hire・insurance は「該当ありでも出さない」＝2026-08-25たきと指示「保険の報告と採用するカードも削除」。
//   カタログから外すだけでは、DBのやること一覧（my_todo_items）に該当があると下の activeOrder が
//   拾って箱が復活する。この2つはカレンダーページの求人カードのボタン（採用する／保険の報告）が
//   唯一の入口so、格子には出さない。実行の窓口は不変＝ボタンの行き先は従来の用件ページのまま。
const REMOVED_STAGES = new Set(["approve", "interview", "w_interview", "hire", "insurance"]);


// 役割ごとの全用件カタログ（並びは正規フロー順・TodayPage の TODO_STAGE_CATALOG の写し）
const STAGE_CATALOG = {
  // 2026-08-22たきと指示「採用する、緊急連絡先、今日の記録、バイトの評価カード削除。
  // アイコンはカレンダーページの各ボタンに配置」＋2026-08-25「保険の報告と採用するカードも削除」＝
  // これらの行為はカレンダーページの求人カードのボタン（採用する／保険の報告／記録する／評価する・
  // 緊急連絡先）が担う＝入口が二重にならない。
  // ★該当ありなら出る（下の activeOrder は my_todo_items の中身から作る）＝用件を取りこぼさない。
  //   ただし hire・insurance だけは上の REMOVED_STAGES で「該当ありでも出さない」に倒してある
  farmer: ["revision", "question"],
  // w_revision（求職の修正）は格子から外した（2026-08-22たきと指示「求職の修正カード非表示」）＝
  // 求職カード（求職一覧・Phase2b）が未実装で、DBのやること一覧も返さない＝常に薄い空箱だったため。
  // ★該当ありなら出る：下の activeOrder は my_todo_items の中身から作るので、将来DBが
  //   w_revision を返し始めたらカタログに戻さなくても箱が現れる（用件を取りこぼさない）
  // 働き手側も同じ名前の2つ（緊急連絡・今日の記録）を削除。
  // ★仕事の評価（w_review）は名指しに無かったので残置＝揃えるなら1行消すだけ
  worker: ["w_review"],
};

export function TodayTaskBoxes({ role = "worker" }) {
  // 応募の変化(Realtime)・画面の復帰で取り直す（TodayPage と同じ合図・2026-08-18 Speed-1B）
  const refreshTick = useRefreshTick(REFRESH_APPLICATIONS);
  const [entries, setEntries] = useState(() => getCache("today:entries") ?? []);
  const [todos, setTodos] = useState(() => getCache("today:todos") ?? []);
  const [profileUnset, setProfileUnset] = useState(() => getCache("today:unset") ?? null);
  const [hiredIds, setHiredIds] = useState(() => new Set(getCache("today:hired") ?? []));
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await getSession();
        if (!session) return;
        const [{ data }, { data: td }, { data: wp }, { data: ep }, { data: emg }, { data: apps }] = await Promise.all([
          fetchMyCalendarJobs(),
          fetchMyTodoItems(),
          fetchMyWorkerProfile(session.user.id, WORKER_UNSET_COLUMNS),
          fetchMyEmployerProfile(session.user.id, EMPLOYER_UNSET_COLUMNS),
          fetchMyEmergencyContact(session.user.id),
          fetchMyApplicationTerms(session.user.id),
        ]);
        if (cancelled) return;
        const rows = data || [];
        setEntries(rows); setCache("today:entries", rows);
        setTodos(td || []); setCache("today:todos", td || []);
        const unset = { w: workerUnsetCount(wp, { hasEmergency: !!emg }).total, f: employerUnsetCount(ep, { hasEmergency: !!emg }).total };
        setProfileUnset(unset); setCache("today:unset", unset);
        const hired = (apps || [])
          .filter(a => a.terms_confirmed_worker_at && a.terms_confirmed_farmer_at
                    && !["rejected","expired","completed"].includes(a.status))
          .map(a => a.id);
        setHiredIds(new Set(hired)); setCache("today:hired", hired);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [refreshTick]);

  // ── 並びの導出（TodayPage と同じ規則）──
  const todayYmd = ymdLocal(new Date());
  const mine = entries.filter(e => e.my_role === role && e.relation === "application");
  const todayJobs = mine.filter(e => entryWorkDays(e).has(todayYmd));
  // 採用済み＝両者の確認が揃った応募（contracted/working は表示用の値で status に来ることもある）
  const hiredMine = mine.filter(e => e.application_id
    && (hiredIds.has(e.application_id) || ["contracted","working"].includes(e.application_status)));
  const tEmergencyCount = (() => {
    const seen = new Set(); let n = 0;
    [...todayJobs.filter(e => e.application_id), ...hiredMine].forEach(e => {
      if (seen.has(e.application_id)) return;
      seen.add(e.application_id); n++;
    });
    return n;
  })();
  const myTodos = todos.filter(t => t.my_role === role && !REMOVED_STAGES.has(t.stage))
    .sort((a, b) => (b.sort_key || "").localeCompare(a.sort_key || "") || (b.job_number || 0) - (a.job_number || 0));
  const counts = new Map();
  if (tEmergencyCount > 0) counts.set("t_emergency", tEmergencyCount);
  const activeOrder = tEmergencyCount > 0 ? ["t_emergency"] : [];
  myTodos.forEach(t => {
    if (!counts.has(t.stage)) { counts.set(t.stage, 0); activeOrder.push(t.stage); }
    counts.set(t.stage, (counts.get(t.stage) || 0) + (t.stage === "t_emergency" ? 0 : 1));
  });
  const catalog = STAGE_CATALOG[role] || [];
  const stageOrder = ["profile", ...activeOrder, ...catalog.filter(st => !activeOrder.includes(st))];
  const unsetN = profileUnset ? (role === "farmer" ? profileUnset.f : profileUnset.w) : 0;
  const accent = role === "worker" ? ROLE_ORANGE : ROLE_GREEN;

  // つぎの予定（7日以内）＝旧・今日ページ本体からの移植（2026-08-22たきと指示「次の予定は移植する」）。
  // 導出・並び・行の見た目は原本（旧TodayPage本体）のまま。行タップで求人ページへ（戻り先＝この面）
  const in7Ymd = ymdLocal(calAddDays(7));
  const upcoming = mine
    .filter(e => e.date_start && e.date_start > todayYmd && e.date_start <= in7Ymd)
    .sort((a, b) => (a.date_start || "").localeCompare(b.date_start || "") || (a.work_time || "").localeCompare(b.work_time || ""));
  const backHash = role === "farmer" ? "/profile/employer" : "/profile";

  const onTapBox = (stage) => {
    if (stage === "profile") {
      // 合図（cb_fillProfile）＝着地した編集ページが最初の未入力ボックスをその場で開く（TodayPage と同じ）
      try { sessionStorage.setItem("cb_fillProfile", "1"); } catch {}
      window.location.hash = role === "farmer" ? "/profile/employer/profile" : "/profile/worker/profile";
      return;
    }
    window.location.hash = "/calendar/todo/" + stage;
  };

  return (
    <div style={{ marginTop:16 }}>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", fontWeight:700, letterSpacing:".06em", margin:"0 0 8px", borderLeft:"3px solid " + accent, paddingLeft:8 }}>やること（{myTodos.length}）</p>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:12 }}>
        {stageOrder.map(stage => {
          const m = BOX_FACE[stage]; if (!m) return null;
          const n = stage === "profile" ? unsetN : (counts.get(stage) || 0);
          const dim = n === 0;
          return (
            <button key={stage} onClick={()=>onTapBox(stage)} className="f-sans" style={{
              position:"relative", background:"#fff", border:"1.5px solid " + accent, borderRadius:18,
              padding:"24px 10px 18px", textAlign:"center", cursor:"pointer", boxShadow:"0 3px 10px rgba(0,0,0,0.10)",
              opacity: dim ? 0.45 : 1,
            }}>
              {/* 件数バッジはプロフィール入力だけ（2026-08-21規約＝相手のいる用件を数字で急かさない） */}
              {stage === "profile" && n > 0 && (
                <span aria-label={"未入力" + n + "件"} style={{ position:"absolute", top:10, right:10, minWidth:24, height:24, borderRadius:12, background:accent, color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 7px" }}>{n}</span>
              )}
              <span style={{ display:"flex", justifyContent:"center", marginBottom:10, color:"#333" }}><NavIcon name={m.iconName} size={BOX_ICON_SIZE} /></span>
              <span style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>{m.label}</span>
            </button>
          );
        })}
      </div>
      {upcoming.length > 0 && (
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
      )}
    </div>
  );
}
