// 月カレンダー（#/calendar/month・分割・大物①・2026-07-24）：当事者applicationsの作業日程アジェンダ＋月グリッド。
// 「今日」ページ(TodayPage)の奥の画面。プロフィール内蔵カレンダーとしても使用（backToToday無し）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { ymdLocal, calAddDays, calFmtDate, CALENDAR_WD, ROLE_ORANGE, ROLE_GREEN, CALENDAR_STATUS_LABEL, CALENDAR_STATUS_COLOR } from "../lib/utils";
import { StatusRibbon, StatusRibbonLeft, NoticeJumpText } from "./ui";
import { AdminJobPreview } from "./AdminJobPreview";
// 重複日の色（2026-07-27たきと指示）：求人期間と求職期間が同じ日に重なる＝二重予約の警告色（既存の警告赤と同色）
const CAL_OVERLAP = "#E24B4A";
// #/calendar：自分（農家・働き手どちらの立場でも）が当事者のapplicationsから、
// 紐づく求人の作業日程を予定表（アジェンダ）として表示。日付タップで該当日へスクロール＆ハイライト。
// jobsテーブルを直接読むとRLS(owner select=farmer_idのみ)で相手方の求人が読めないため、
// get_my_calendar_jobs（SECURITY DEFINER）経由で自分の当事者applicationsに紐づく行だけ取得する。
export function MyCalendar({ backToToday }) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]); // [{job_number,crop,task,work_time,town,date_start,date_end,application_id,application_status,partner_name}]
  const [cvYear, setCvYear] = useState(new Date().getFullYear());
  const [cvMonth, setCvMonth] = useState(new Date().getMonth());
  const [selectedDay, setSelectedDay] = useState(null);
  const [showEnded, setShowEnded] = useState(false);
  // 予定エントリの安定キー（2026-07-19）：応募なしの行（own/liked）はapplication_idがundefinedで衝突するため、
  // job_number＋relationも混ぜて一意化。ハイライトのキー衝突（該当しない求人まで変色）の根治に使う
  const entryKey = (e) => e.application_id || `j${e.job_number}-${e.relation || ""}`;
  const [likedIds, setLikedIds] = useState(() => new Set()); // いいね済みjob_number（❤️表示）
  const [previewDraft, setPreviewDraft] = useState(null); // 下書きカードタップ→プレビューボックス（再開/削除・2026-07-16）
  // 下書きを進めませんか？（2026-07-19）：カレンダータップ（タブを開いた時）に下書きがあればボックス展開。
  // カードタップ→保存済みステップから求人フロー再開（#/work/edit/{n}・hashだけでshowJobPostが立つ既存レール）
  const [draftPrompt, setDraftPrompt] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase.from("jobs").select("job_number,crop,task,photos,draft_step,opened_at").eq("farmer_id", session.user.id).eq("status", "draft").order("created_at", { ascending: false });
        const drafts = (data || []).filter(j => !j.opened_at); // 一時非公開（open経験あり）は下書きではないので除外
        if (drafts.length > 0) setDraftPrompt(drafts);
      } catch {}
    })();
  }, []);
  const [flashNoPlan, setFlashNoPlan] = useState(false);
  const rowRefs = useRef({});
  const flashTimer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data, error } = await supabase.rpc("get_my_calendar_jobs");
        if (!cancelled) setEntries(error ? [] : (data || []));
        // いいね済み求人（❤️バッジ用・自分のsaved_jobsのみ）
        const { data: saved } = await supabase.from("saved_jobs").select("job_number").eq("worker_id", session.user.id);
        if (!cancelled && saved) setLikedIds(new Set(saved.map(r => r.job_number)));
      } catch {}
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const todayYmd = ymdLocal(new Date());
  const tomorrowYmd = ymdLocal(calAddDays(1));
  const day2Ymd = ymdLocal(calAddDays(2));
  const weekEndYmd = ymdLocal(calAddDays(6));
  const bucketOf = (e) => {
    const s = e.date_start, en = e.date_end || e.date_start;
    if (!s) return null;
    if (en < todayYmd) return "ended";
    if (s <= todayYmd && todayYmd <= en) return "today";
    if (s <= tomorrowYmd && tomorrowYmd <= en) return "tomorrow";
    if (s <= weekEndYmd && en >= day2Ymd) return "thisWeek";
    return "later";
  };
  const entriesOnDay = (dt) => {
    const ymd = ymdLocal(dt);
    return entries.filter(e => e.date_start && ymd >= e.date_start && ymd <= (e.date_end || e.date_start));
  };

  const prevMo = () => { if (cvMonth === 0) { setCvYear(y => y - 1); setCvMonth(11); } else setCvMonth(m => m - 1); };
  const nextMo = () => { if (cvMonth === 11) { setCvYear(y => y + 1); setCvMonth(0); } else setCvMonth(m => m + 1); };
  // カレンダーのスワイプ月送り（2026-07-19）：左スワイプ=次月/右スワイプ=前月。
  // 判定は求人フローと同じ作法（60px以上かつ横が縦の1.5倍）。切替時は求人フローの横滑りアニメを流用
  const calTouch = useRef(null);
  const [calAnim, setCalAnim] = useState("");
  const onCalTouchStart = (e) => { calTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onCalTouchEnd = (e) => {
    const s = calTouch.current; calTouch.current = null;
    if (!s || !e.changedTouches || !e.changedTouches[0]) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) { nextMo(); setCalAnim("step-in-right"); } else { prevMo(); setCalAnim("step-in-left"); }
    setTimeout(() => setCalAnim(""), 450);
  };
  const firstDay = new Date(cvYear, cvMonth, 1).getDay();
  const daysInMonth = new Date(cvYear, cvMonth + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let dd = 1; dd <= daysInMonth; dd++) cells.push(dd);

  const onDayTap = (dt) => {
    setSelectedDay(dt);
    const matches = entriesOnDay(dt);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    if (matches.length === 0) {
      setFlashNoPlan(true);
      flashTimer.current = setTimeout(() => setFlashNoPlan(false), 1800);
      return;
    }
    setFlashNoPlan(false);
    // ハイライトはselectedDayから直接導出（下のAgendaRow）。ここでは対象行へスクロールするだけ
    const needsEndedOpen = matches.every(m => bucketOf(m) === "ended") && !showEnded;
    if (needsEndedOpen) setShowEnded(true);
    setTimeout(() => {
      const el = rowRefs.current[entryKey(matches[0])];
      if (el) el.scrollIntoView({ behavior:"smooth", block:"center" });
    }, needsEndedOpen ? 60 : 0);
  };

  const grouped = { today:[], tomorrow:[], thisWeek:[], later:[], ended:[] };
  entries.forEach(e => { const b = bucketOf(e); if (b) grouped[b].push(e); });
  const byDateAsc = (a, b) => (a.date_start||"").localeCompare(b.date_start||"") || (a.work_time||"").localeCompare(b.work_time||"");
  grouped.today.sort(byDateAsc); grouped.tomorrow.sort(byDateAsc); grouped.thisWeek.sort(byDateAsc); grouped.later.sort(byDateAsc);
  grouped.ended.sort((a, b) => (b.date_start||"").localeCompare(a.date_start||""));

  // 他の一覧と同設計のボックス（2026-07-16）：正方形写真＋状態リボン＋タイトル。いいね済みは右上に❤️
  const AgendaRow = ({ e }) => {
    const c = CALENDAR_STATUS_COLOR(e.application_status);
    const dateLabel = e.date_end && e.date_end !== e.date_start ? `${calFmtDate(e.date_start)}〜${calFmtDate(e.date_end)}` : calFmtDate(e.date_start);
    // 選択中の日に該当する予定だけ変色（2026-07-19）：日付範囲を直接判定＝キー衝突なし・選択中は色を保つ
    const highlighted = !!(selectedDay && e.date_start && ymdLocal(selectedDay) >= e.date_start && ymdLocal(selectedDay) <= (e.date_end || e.date_start));
    const photo = e.photos && e.photos[0] ? (typeof e.photos[0] === "string" ? e.photos[0] : e.photos[0]?.url) : null;
    return (
      <button
        ref={el => { rowRefs.current[entryKey(e)] = el; }}
        onClick={() => {
          // 下書きは詳細ページが無い（未公開）ため、プレビューボックスを展開して再開/削除（2026-07-16）
          if (e.status === "draft") { setPreviewDraft(e.job_number); return; }
          try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {}
          window.location.hash = "/work/job/" + e.job_number;
        }}
        className="f-sans"
        style={{ display:"block", width:"100%", textAlign:"left", background: highlighted ? "#FFF6DE" : "#fff", border:"1px solid #EBEBEB", borderLeft:"4px solid " + (e.my_role === "worker" ? ROLE_ORANGE : ROLE_GREEN), borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer", transition:"background .5s" }}
      >
        <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, overflow:"hidden" }}>
          {photo ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌾"}
          {/* 求人本体が下書き/審査中に戻っている場合はそちらを優先表示（完了帯との勘違い防止・2026-07-16）。
              応募なしの行（relation=own/liked・2026-07-16追加）は由来で帯を出し分け */}
          {e.status === "draft" ? (
            <StatusRibbon label="下書き" color="#8A6D1D" />
          ) : e.status === "pending" ? (
            <StatusRibbon label="審査中" color="#C77700" />
          ) : e.relation === "liked" ? (
            <StatusRibbon label="いいね" color="#E24B4A" />
          ) : !e.application_status ? (
            <StatusRibbon label="公開中" color="#00A86B" />
          ) : (
            <StatusRibbon label={CALENDAR_STATUS_LABEL[e.application_status] || e.application_status} color={c.fg === "#00A86B" ? "#00A86B" : e.application_status === "completed" ? "#9E9E9E" : "#C77700"} />
          )}
          {likedIds.has(e.job_number) && (
            <span style={{ position:"absolute", bottom:8, right:8, width:28, height:28, borderRadius:"50%", background:"rgba(255,255,255,0.92)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, boxShadow:"0 1px 4px rgba(0,0,0,0.15)", zIndex:1 }}>❤️</span>
          )}
        </div>
        <div style={{ padding:"8px 10px 10px" }}>
          <p style={{ fontSize:13, fontWeight:600, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[e.crop, e.task].filter(Boolean).join(" ") || "求人"}</p>
          <p style={{ fontSize:11, color:"#999", margin:"2px 0 0", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>📅 {dateLabel}{e.work_time ? "　" + e.work_time : ""}</p>
        </div>
      </button>
    );
  };

  const AgendaGroup = ({ title, list }) => list.length === 0 ? null : (
    <div style={{ marginBottom:20 }}>
      <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", marginBottom:8 }}>{title}</p>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>
        {list.map(e => <AgendaRow key={e.application_id || `j${e.job_number}-${e.relation || ""}`} e={e} />)}
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth:600, margin:"0 auto", padding:"8px 0 24px" }}>
      {/* 「今日」の奥の画面（2026-07-24）：ナビ「今日」から来た時だけ、先頭に今日へ戻る導線を出す（プロフィール内蔵のカレンダーでは出さない） */}
      {backToToday && <button onClick={()=>{ window.location.hash="/calendar"; }} className="f-sans" style={{ background:"none", border:"none", color:"#717171", fontSize:14, cursor:"pointer", padding:"4px 0 12px", display:"inline-flex", alignItems:"center", gap:6 }}>← 今日</button>}
      <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:"0 0 20px" }}>{backToToday ? "月の予定" : "カレンダー"}</h2>
      {/* 下書きを進めませんか？ボックス（2026-07-19）：下書きカードタップ→保存済みステップから求人フロー再開。
          意匠はお知らせボックスの規格（左詰め・緑太縁3px・タイトルと説明の間に横線・上限30px/下限フッター+40px・タイトル20/本文18） */}
      {draftPrompt && (
        <div onClick={()=>setDraftPrompt(null)} className="cb-box-overlay" style={{ zIndex:8000 }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up cb-notice-sheet">
            <button onClick={()=>setDraftPrompt(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0 }}><NoticeJumpText text="📝 下書きを進めませんか？" /></p>
            <div style={{ height:1, background:"#E5E5E5", margin:"14px 0" }} />
            <div>
              <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:"0 0 14px" }}>作成途中の求人があります。カードをタップすると、続きから再開できます。</p>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>
                {draftPrompt.map(j => {
                  const photo = j.photos && j.photos[0] ? (typeof j.photos[0] === "string" ? j.photos[0] : j.photos[0]?.url) : null;
                  return (
                    <button key={j.job_number} onClick={()=>{ setDraftPrompt(null); window.location.hash = "/work/edit/" + j.job_number; }}
                      className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:0, overflow:"hidden", cursor:"pointer" }}>
                      <div style={{ position:"relative", aspectRatio:"1 / 1", background:"#F7F7F7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32, overflow:"hidden" }}>
                        {photo ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌾"}
                        <StatusRibbonLeft label="下書き" color="#717171" />
                      </div>
                      <p className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", margin:0, padding:"7px 8px 9px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[j.crop, j.task].filter(Boolean).join(" ") || ("求人 #" + j.job_number)}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      {loading ? (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中...</p>
      ) : entries.length === 0 ? (
        <div style={{ textAlign:"center", padding:"56px 20px", color:"#999" }} className="f-sans">
          <div style={{ fontSize:40, marginBottom:12 }}>📅</div>
          <p style={{ fontSize:14, margin:0 }}>予定はまだありません。<br/>応募が承認されると、ここに表示されます。</p>
        </div>
      ) : (
        <>
          <div onTouchStart={onCalTouchStart} onTouchEnd={onCalTouchEnd} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:10, touchAction:"pan-y", overflow:"hidden" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
              <button onClick={prevMo} style={{ background:"#F7F7F7", border:"none", borderRadius:8, padding:"5px 10px", cursor:"pointer", fontSize:13 }}>{"‹"}</button>
              <span className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222" }}>{cvYear}年{cvMonth+1}月</span>
              <button onClick={nextMo} style={{ background:"#F7F7F7", border:"none", borderRadius:8, padding:"5px 10px", cursor:"pointer", fontSize:13 }}>{"›"}</button>
            </div>
            <div key={`${cvYear}-${cvMonth}`} className={calAnim} style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:1, marginBottom:2 }}>
              {CALENDAR_WD.map(wd => <div key={wd} style={{ textAlign:"center", fontSize:9, color:"#B0B0B0", padding:"2px 0" }}>{wd}</div>)}
              {cells.map((dd, i) => {
                if (!dd) return <div key={`e${i}`} />;
                const dt = new Date(cvYear, cvMonth, dd);
                const ymd = ymdLocal(dt);
                // 予定のある日は塗りつぶし（2026-07-27たきと指示：求人フローのカレンダーと同じ形式に統一）。
                // 求人期間（農家として）=緑／求職期間（働き手として）=橙／両方が重なる日=赤
                const es = entriesOnDay(dt);
                const hasFarmer = es.some(e => e.my_role === "farmer");
                const hasWorker = es.some(e => e.my_role === "worker");
                const fill = (hasFarmer && hasWorker) ? CAL_OVERLAP : hasFarmer ? ROLE_GREEN : hasWorker ? ROLE_ORANGE : null;
                const isToday = ymd === todayYmd;
                const isSelected = selectedDay && ymdLocal(selectedDay) === ymd;
                return (
                  <button key={dd} onClick={() => onDayTap(dt)} style={{
                    padding:"7px 2px", borderRadius:8, border:"none", cursor:"pointer", fontSize:12, textAlign:"center",
                    background: fill || (isSelected ? "#E6F7EF" : "transparent"),
                    color: fill ? "#fff" : "#222", fontWeight: (fill || isToday) ? 700 : 400,
                    boxShadow: isToday ? "inset 0 0 0 1.5px #00A86B" : "none",
                  }}>{dd}</button>
                );
              })}
            </div>
          </div>
          {/* 役割色の凡例（第11弾） */}
          <div style={{ display:"flex", justifyContent:"center", gap:16, marginTop:8 }}>
            <span className="f-sans" style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#717171" }}><span style={{ width:10, height:10, borderRadius:3, background:ROLE_GREEN }} />求人期間</span>
            <span className="f-sans" style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#717171" }}><span style={{ width:10, height:10, borderRadius:3, background:ROLE_ORANGE }} />求職期間</span>
            <span className="f-sans" style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#717171" }}><span style={{ width:10, height:10, borderRadius:3, background:CAL_OVERLAP }} />重複</span>
          </div>
          {flashNoPlan && (
            <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", textAlign:"center", margin:"10px 0 0" }}>この日の予定はありません。</p>
          )}
          <div style={{ marginTop:20 }}>
            <AgendaGroup title="今日" list={grouped.today} />
            <AgendaGroup title="明日" list={grouped.tomorrow} />
            <AgendaGroup title="今週" list={grouped.thisWeek} />
            <AgendaGroup title="それ以降" list={grouped.later} />
            {/* 下書きのプレビューボックス（農家プロの作成中カードと同じ・再開/削除付き・2026-07-16） */}
            {previewDraft && (
              <AdminJobPreview jobNumber={previewDraft} ownerView
                onClose={() => setPreviewDraft(null)}
                onResumeJob={() => { const n = previewDraft; setPreviewDraft(null); window.location.hash = "/work/edit/" + n; }}
                onDeleteJob={async () => {
                  if (!confirm("この求人（下書き）を削除しますか？元に戻せません")) return;
                  const { data: { session } } = await supabase.auth.getSession();
                  if (!session) return;
                  const { error } = await supabase.from("jobs").delete().eq("job_number", previewDraft).eq("farmer_id", session.user.id);
                  if (error) { alert("削除に失敗しました：" + error.message); return; }
                  setEntries(prev => prev.filter(x => x.job_number !== previewDraft));
                  setPreviewDraft(null);
                }} />
            )}
            {grouped.ended.length > 0 && (
              <div>
                <button onClick={() => setShowEnded(v => !v)} className="f-sans" style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, fontWeight:700, color:"#717171", padding:"4px 0", marginBottom:8 }}>
                  {showEnded ? "▾" : "▸"} 過去{grouped.ended.length}件
                </button>
                {/* 過去もそれ以降と同じ3列グリッド・同じカード設計（2026-07-16） */}
                {showEnded && (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>
                    {grouped.ended.map(e => <AgendaRow key={e.application_id || `j${e.job_number}-${e.relation || ""}`} e={e} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
