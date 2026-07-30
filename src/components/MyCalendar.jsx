// 月カレンダー（#/calendar/month・分割・大物①・2026-07-24）：当事者applicationsの作業日程を月グリッドに塗る部品。
// 「今日」ページ(TodayPage)の奥の画面。プロフィール内蔵カレンダー・応募者ページ上部でも使用（backToToday無し）。
// 予定カード（アジェンダ）は2026-07-27に廃止：カレンダーは「日を選ぶ」だけを担い、
// 選んだ日の求人をどう見せるかは置き場所を持つページ側（応募者ページ）の仕事＝onDayTapJobsで渡す。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { ymdLocal, CALENDAR_WD, ROLE_ORANGE, ROLE_GREEN, isJobDraft, appPhaseKey, APP_PHASE_LABEL, APP_PHASE_COLOR } from "../lib/utils";
import { StatusRibbonLeft, NoticeJumpText } from "./ui";
// 重複日の色（2026-07-27たきと指示）：求人期間と求職期間が同じ日に重なる＝二重予約の警告色（既存の警告赤と同色）
const CAL_OVERLAP = "#E24B4A";
// #/calendar：自分（農家・働き手どちらの立場でも）が当事者のapplicationsから、
// 紐づく求人の作業日程を月グリッドに塗る。日付タップ＝その日の求人番号を親へ通知。
// jobsテーブルを直接読むとRLS(owner select=farmer_idのみ)で相手方の求人が読めないため、
// get_my_calendar_jobs（SECURITY DEFINER）経由で自分の当事者applicationsに紐づく行だけ取得する。
export function MyCalendar({ backToToday, onDayTapJobs }) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]); // [{job_number,crop,task,work_time,town,date_start,date_end,application_id,application_status,partner_name}]
  const [cvYear, setCvYear] = useState(new Date().getFullYear());
  const [cvMonth, setCvMonth] = useState(new Date().getMonth());
  const [selectedDay, setSelectedDay] = useState(null);
  const [likedIds, setLikedIds] = useState(() => new Set()); // いいね済みjob_number（❤️表示）
  // 下書きを進めませんか？（2026-07-19）：カレンダータップ（タブを開いた時）に下書きがあればボックス展開。
  // カードタップ→保存済みステップから求人フロー再開（#/work/edit/{n}・hashだけでshowJobPostが立つ既存レール）
  const [draftPrompt, setDraftPrompt] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        // ★下書きの定義は lib/utils の isJobDraft に一本化（2026-07-27たきと指示）。
        //   以前はここだけ「status=draft かつ 掲載歴なし」で見ており、日程が過ぎた求人（＝終了）まで
        //   下書きとして「進めませんか？」が出ていた。判定に必要な日付・勤務時間も取得する
        const { data } = await supabase.from("jobs").select("job_number,crop,task,photos,draft_step,opened_at,status,date_start,date_end,work_time").eq("farmer_id", session.user.id).eq("status", "draft").order("created_at", { ascending: false });
        const drafts = (data || []).filter(isJobDraft);
        if (drafts.length > 0) setDraftPrompt(drafts);
      } catch {}
    })();
  }, []);
  const [flashNoPlan, setFlashNoPlan] = useState(false);
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
  const entriesOnDay = (dt) => {
    const ymd = ymdLocal(dt);
    return entries.filter(e => e.date_start && ymd >= e.date_start && ymd <= (e.date_end || e.date_start));
  };
  // ── 名前チップ「誰がいつ来るか」（2026-07-29たきと指示）──
  // 出すのは採用済みだけ＝両者の確認時刻が揃った応募（面接中はまだ来ると確定していないので出さない）。
  // 段階は appPhaseKey（帯の唯一のソース）で導く。statusは承認後も'approved'のままで、
  // 面接中と採用の区別は terms_confirmed_*_at にしか無いため、RPCにこの2列を返させている
  // （migration 20260729…_calendar_terms_confirmed_for_phase）。
  const HIRED_PHASES = ["contracted", "working"];
  const phaseOfEntry = (e) => appPhaseKey({
    status: e.application_status,
    terms_confirmed_worker_at: e.terms_confirmed_worker_at,
    terms_confirmed_farmer_at: e.terms_confirmed_farmer_at,
  });
  // 働く日（agreed_dates）が確定していればその日だけ、未確定なら求人の日程どおりに出す
  const comesOnDay = (e, ymd) => {
    if (e.relation !== "application" || !e.partner_name) return false;
    if (!HIRED_PHASES.includes(phaseOfEntry(e))) return false;
    if (Array.isArray(e.agreed_dates) && e.agreed_dates.length > 0) return e.agreed_dates.includes(ymd);
    return !!e.date_start && ymd >= e.date_start && ymd <= (e.date_end || e.date_start);
  };
  const chipsOnDay = (dt) => { const ymd = ymdLocal(dt); return entries.filter(e => comesOnDay(e, ymd)); };

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
      onDayTapJobs?.(ymdLocal(dt), []);
      return;
    }
    setFlashNoPlan(false);
    // 予定カード（アジェンダ）は廃止（2026-07-27たきと指示）。日付タップの行き先は、
    // 置き場所を持っているページ側（応募者ページ）へ渡す＝カレンダーは「日を選ぶ」だけの部品になる
    onDayTapJobs?.(ymdLocal(dt), [...new Set(matches.map(m => m.job_number))]);
  };

  return (
    <div style={{ maxWidth:600, margin:"0 auto", padding:"8px 0 24px" }}>
      {/* 「今日」の奥の画面（2026-07-24）：ナビ「今日」から来た時だけ、先頭に今日へ戻る導線を出す（プロフィール内蔵のカレンダーでは出さない） */}
      {backToToday && <button onClick={()=>{ window.location.hash="/calendar"; }} className="f-sans" style={{ background:"none", border:"none", color:"#717171", fontSize:14, cursor:"pointer", padding:"4px 0 12px", display:"inline-flex", alignItems:"center", gap:6 }}>← 今日</button>}
      {/* 見出し「カレンダー」は削除（2026-07-27たきと指示）：カレンダーを見れば分かる＝重複。
          「今日」から入った月の予定（backToToday）だけは、どの画面かの手がかりとして残す */}
      {backToToday && <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:"0 0 20px" }}>月の予定</h2>}
      {/* 下書きを進めませんか？ボックス（2026-07-19）：下書きカードタップ→保存済みステップから求人フロー再開。
          意匠はお知らせボックスの規格（左詰め・緑太縁3px・タイトルと説明の間に横線・上限30px/下限フッター+40px・タイトル20/本文18） */}
      {draftPrompt && (
        <div onClick={()=>setDraftPrompt(null)} className="cb-box-overlay" style={{ zIndex:8000 }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up cb-notice-sheet">
            {/* ✕ボタンは置かない（2026-07-27たきと指示）：ボックス外タップで閉じられるso重複 */}
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
      {/* 読み込み中の骨は〈○○年○○月〉の見出し1本ぶんだけ（2026-07-29たきと指示）。
          盤面ぶんの大きな面は出さない＝展開の順番（見出しが出て、そこから下に開く）と骨の形が一致する */}
      {loading ? (
        <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:10 }}>
          <div aria-busy="true" aria-label="読み込み中" className="ghost-line" style={{ height:27, borderRadius:8 }} />
        </div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign:"center", padding:"56px 20px", color:"#999" }} className="f-sans">
          <div style={{ fontSize:40, marginBottom:12 }}>📅</div>
          <p style={{ fontSize:14, margin:0 }}>予定はまだありません。<br/>応募が承認されると、ここに表示されます。</p>
        </div>
      ) : (
        <>
          <div onTouchStart={onCalTouchStart} onTouchEnd={onCalTouchEnd} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:10, touchAction:"pan-y", overflow:"hidden" }}>
            {/* 展開の2段（2026-07-27）：見出し（○○年○○月）が先に入り、盤面が少し遅れて開く */}
            <div className="cb-cal-head" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
              <button onClick={prevMo} style={{ background:"#F7F7F7", border:"none", borderRadius:8, padding:"5px 10px", cursor:"pointer", fontSize:13 }}>{"‹"}</button>
              <span className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222" }}>{cvYear}年{cvMonth+1}月</span>
              <button onClick={nextMo} style={{ background:"#F7F7F7", border:"none", borderRadius:8, padding:"5px 10px", cursor:"pointer", fontSize:13 }}>{"›"}</button>
            </div>
            {/* ②縦の展開はここから下（見出しの帯が横に伸び切ってから開く・2026-07-27たきと指示） */}
            <div className="cb-cal-body-wrap"><div>
            <div key={`${cvYear}-${cvMonth}`} className={calAnim} style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:1, marginBottom:2 }}>
              {CALENDAR_WD.map(wd => <div key={wd} style={{ textAlign:"center", fontSize:9, color:"#B0B0B0", padding:"2px 0" }}>{wd}</div>)}
              {cells.map((dd, i) => {
                if (!dd) return <div key={`e${i}`} />;
                const dt = new Date(cvYear, cvMonth, dd);
                const ymd = ymdLocal(dt);
                // 予定のある日は塗りつぶし（2026-07-27たきと指示：求人フローのカレンダーと同じ形式に統一）。
                // 求人期間（農家として）=緑／求職期間（働き手として）=橙／両方が重なる日=赤。
                // 濃さは公開中（jobs.status='open'）だけ濃色、それ以外（下書き・審査中・終了等）は薄色（同日改定）
                const es = entriesOnDay(dt);
                const farmerEs = es.filter(e => e.my_role === "farmer");
                const workerEs = es.filter(e => e.my_role === "worker");
                const hasFarmer = farmerEs.length > 0;
                const hasWorker = workerEs.length > 0;
                const isOpen = es.some(e => e.status === "open"); // 公開中が1件でもあれば濃色
                const baseColor = (hasFarmer && hasWorker) ? CAL_OVERLAP : hasFarmer ? ROLE_GREEN : hasWorker ? ROLE_ORANGE : null;
                // 名前チップが乗る日は塗りを薄くする（2026-07-29たきと指示）＝濃い地に濃いチップを重ねない。
                // 濃淡の既存ルール（濃い=公開中）はチップの無い日でそのまま維持される
                const chips = chipsOnDay(dt);
                // 薄色＝同じ色の8%（+"14"）。文字は色に沿った濃い字にして読めるようにする
                const solid = isOpen && chips.length === 0;
                const fillBg = baseColor ? (solid ? baseColor : baseColor + "22") : null;
                const fillFg = baseColor ? (solid ? "#fff" : baseColor) : "#222";
                const liked = es.some(e => e.relation === "liked" || likedIds.has(e.job_number)); // いいね済み＝右上に小さく❤️
                const isToday = ymd === todayYmd;
                const isSelected = selectedDay && ymdLocal(selectedDay) === ymd;
                return (
                  <button key={dd} onClick={() => onDayTap(dt)} style={{
                    position:"relative", padding:"7px 2px", borderRadius:8, border:"none", cursor:"pointer", fontSize:12, textAlign:"center",
                    background: fillBg || (isSelected ? "#E6F7EF" : "transparent"),
                    color: fillFg, fontWeight: (baseColor || isToday) ? 700 : 400,
                    boxShadow: isToday ? "inset 0 0 0 1.5px #00A86B" : "none",
                    display:"flex", flexDirection:"column", alignItems:"stretch", gap:2, minHeight: chips.length > 0 ? 46 : undefined,
                  }}>
                    <span>{dd}</span>
                    {/* 誰が来るか（採用済みのみ）。色は段階色＝帯・チャットと同じ体系。
                        名前はニックネーム（未設定ならメール頭2文字）で、本名は返らない（resolve_actor_name） */}
                    {chips.slice(0, 2).map(e => (
                      <span key={e.application_id} title={`${e.partner_name}（${APP_PHASE_LABEL[phaseOfEntry(e)]}）`}
                        className="f-sans" style={{
                          background: APP_PHASE_COLOR[phaseOfEntry(e)], color:"#fff",
                          fontSize:9, fontWeight:700, lineHeight:1.5, borderRadius:3, padding:"0 3px",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block",
                        }}>{e.partner_name}</span>
                    ))}
                    {chips.length > 2 && (
                      <span className="f-sans" style={{ fontSize:8, fontWeight:700, color:"#717171", lineHeight:1.4 }}>＋{chips.length - 2}</span>
                    )}
                    {liked && <span aria-hidden="true" style={{ position:"absolute", top:1, right:2, fontSize:8, lineHeight:1 }}>❤️</span>}
                  </button>
                );
              })}
            </div>
            </div></div>{/* ②縦の展開ここまで */}
          </div>
          {/* 役割色の凡例（第11弾） */}
          <div style={{ display:"flex", justifyContent:"center", gap:16, marginTop:8 }}>
            <span className="f-sans" style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#717171" }}><span style={{ width:10, height:10, borderRadius:3, background:ROLE_GREEN }} />求人期間</span>
            <span className="f-sans" style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#717171" }}><span style={{ width:10, height:10, borderRadius:3, background:ROLE_ORANGE }} />求職期間</span>
            <span className="f-sans" style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#717171" }}><span style={{ width:10, height:10, borderRadius:3, background:CAL_OVERLAP }} />重複</span>
          </div>
          {/* 名前チップの凡例（2026-07-29）：段階色は帯・チャットと同じ体系なので、ここでも同じ意味で読める */}
          <div style={{ display:"flex", justifyContent:"center", gap:14, marginTop:6, flexWrap:"wrap" }}>
            {["contracted","working"].map(k => (
              <span key={k} className="f-sans" style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#717171" }}>
                <span style={{ background:APP_PHASE_COLOR[k], color:"#fff", fontSize:9, fontWeight:700, borderRadius:3, padding:"0 4px", lineHeight:1.6 }}>名前</span>
                {APP_PHASE_LABEL[k]}
              </span>
            ))}
          </div>
          {/* 濃淡の意味（2026-07-27たきと指示）：公開中だけ濃く、それ以外（下書き・審査中・終了）は薄く */}
          <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", textAlign:"center", margin:"4px 0 0" }}>濃い色＝公開中／薄い色＝それ以外　❤️＝いいね</p>
          <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", textAlign:"center", margin:"2px 0 0" }}>名前は採用が決まった方のみ表示されます（面接中は出ません）</p>
          {flashNoPlan && (
            <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", textAlign:"center", margin:"10px 0 0" }}>この日の予定はありません。</p>
          )}
        </>
      )}
    </div>
  );
}
