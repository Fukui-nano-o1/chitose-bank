// 📆 今日ページ（分割・段階2で切り出し・2026-07-24）：ナビ4番。やること（my_todo_items）＋きょうの仕事＋つぎの予定＋メモ。
import { useState, useEffect, Fragment } from "react";
import { supabase } from "../lib/supabase";
import { ymdLocal, calAddDays, calFmtDate, ROLE_ORANGE, ROLE_GREEN } from "../lib/utils";
import { Avatar } from "./ui";
// #/calendar：ナビ4番「📆 今日」。きょうの契約済み仕事＋つぎの予定（向こう7日）。月カレンダーは奥（#/calendar/month）。
// 両役（働き手・農家）を持つ人だけ役割タブを出す。タブはこのページの表示だけを切替（全体モードは変えない）。
export function TodayPage({ me, defaultRole }) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  const [hasWorker, setHasWorker] = useState(false);
  const [hasFarmer, setHasFarmer] = useState(false);
  const [role, setRole] = useState(defaultRole === "farmer" ? "farmer" : "worker");
  const [subMap, setSubMap] = useState({});   // application_id→{started_at,farmer_confirmed_start_at,status,insurance_prepared_at}（当日の行動の判定用）
  const [todos, setTodos] = useState([]);     // やることフィード（my_todo_items・状態カードの単一ソース）
  const [confirming, setConfirming] = useState("");
  const [memo, setMemo] = useState(() => { try { return localStorage.getItem("cb_todayMemo") || ""; } catch { return ""; } }); // 私的メモ（端末内・本人のみ）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data } = await supabase.rpc("get_my_calendar_jobs");
        const rows = data || [];
        if (cancelled) return;
        setEntries(rows);
        const { data: td } = await supabase.rpc("my_todo_items");
        if (!cancelled) setTodos(td || []);
        // 当日の行動の判定用サブ状態＋保険未報告リスト
        const appIds = rows.filter(r => r.application_id).map(r => r.application_id);
        if (appIds.length) {
          const { data: subs } = await supabase.from("applications").select("id,started_at,farmer_confirmed_start_at,status,insurance_prepared_at,attended").in("id", appIds);
          if (!cancelled && subs) setSubMap(Object.fromEntries(subs.map(s => [s.id, s])));
        }
        const [{ data: wp }, { count: jc }, { data: ep }] = await Promise.all([
          supabase.from("worker_profiles").select("auth_id").eq("auth_id", session.user.id).maybeSingle(),
          supabase.from("jobs").select("job_number", { count: "exact", head: true }).eq("farmer_id", session.user.id),
          supabase.from("employer_profiles").select("auth_id").eq("auth_id", session.user.id).maybeSingle(),
        ]);
        if (cancelled) return;
        const w = !!wp || rows.some(e => e.my_role === "worker");
        const f = (jc || 0) > 0 || !!ep || rows.some(e => e.my_role === "farmer");
        setHasWorker(w); setHasFarmer(f);
        // 既定ロールが持っていない側なら、持っている側へ寄せる
        setRole(r => (r === "worker" && !w && f) ? "farmer" : (r === "farmer" && !f && w) ? "worker" : r);
      } catch {}
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const todayYmd = ymdLocal(new Date());
  const in7Ymd = ymdLocal(calAddDays(7));
  const mine = entries.filter(e => e.my_role === role && e.relation === "application");
  // 当日判定（2026-07-24 追記3）：agreed_dates（確定した働く日）があれば当日∈agreed_dates、無ければ従来の期間判定
  const hasAgreed = (e) => Array.isArray(e.agreed_dates) && e.agreed_dates.length > 0;
  const isTodayJob = (e) => e.date_start && (hasAgreed(e) ? e.agreed_dates.includes(todayYmd) : (e.date_start <= todayYmd && todayYmd <= (e.date_end || e.date_start)));
  const todayJobs = mine
    .filter(isTodayJob)
    .sort((a, b) => (a.work_time || "").localeCompare(b.work_time || ""));
  const upcoming = mine
    .filter(e => e.date_start && e.date_start > todayYmd && e.date_start <= in7Ymd)
    .sort((a, b) => (a.date_start || "").localeCompare(b.date_start || "") || (a.work_time || "").localeCompare(b.work_time || ""));
  const dual = hasWorker && hasFarmer;
  const accent = role === "worker" ? ROLE_ORANGE : ROLE_GREEN;
  const handshakeHash = role === "worker" ? "/profile/worker/approved" : "/profile/employer/applicants";

  // きょうの仕事カード（#N・作物 作業・時間帯・相手＋行動ボタン）
  const TodayCard = ({ e }) => {
    const photo = e.photos && e.photos[0] ? (typeof e.photos[0] === "string" ? e.photos[0] : e.photos[0]?.url) : null;
    const title = [e.crop, e.task].filter(Boolean).join(" ") || "求人";
    const btn = (label, bg, fg, onClick, border) => (
      <button onClick={onClick} className="f-sans" style={{ flex:"1 1 46%", minWidth:0, padding:"11px 8px", fontSize:13, fontWeight:700, background:bg, color:fg, border:border||"none", borderRadius:10, cursor:"pointer", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{label}</button>
    );
    return (
      <div style={{ border:"1px solid #EBEBEB", borderLeft:"4px solid " + accent, borderRadius:14, background:"#fff", overflow:"hidden" }}>
        <div style={{ display:"flex", gap:12, padding:"14px 14px 10px", alignItems:"center" }}>
          <div style={{ width:56, height:56, borderRadius:10, background:"#F7F7F7", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, overflow:"hidden" }}>
            {photo ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌾"}
          </div>
          <div style={{ minWidth:0, flex:1 }}>
            <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 2px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{title} <span style={{ color:"#999", fontWeight:700, fontSize:12 }}>#{e.job_number}</span></p>
            {e.work_time && <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0 }}>🕒 {e.work_time}</p>}
            {/* A案：農家タブ＝働き手名を表示（自分の応募者）。働き手タブ＝相手名は出さない */}
            {role === "farmer" && e.partner_name && <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"2px 0 0", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>👤 {e.partner_name}</p>}
          </div>
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, padding:"0 14px 14px" }}>
          {btn("確認カード", "#F7F7F7", "#222", () => { try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {} window.location.hash = "/work/job/" + e.job_number; }, "1px solid #EBEBEB")}
          {/* 当日の主操作（引っ越し(3)）：農家＝開始確認→完了して評価する（今日ページの決定表どおり）。働き手＝自分の打刻ページへ */}
          {role === "farmer" ? (() => {
            const sub = subMap[e.application_id] || {};
            if (sub.status === "completed") return <span className="f-sans" style={{ flex:"1 1 46%", textAlign:"center", padding:"11px 8px", fontSize:12, fontWeight:700, color: sub.attended===false ? "#E24B4A" : "#00A86B" }}>{sub.attended===false ? "欠勤記録済み" : "✓ 完了・評価済み"}</span>;
            if (sub.started_at && !sub.farmer_confirmed_start_at) {
              return btn(confirming===e.application_id ? "…" : "✓ 開始を確認", accent, "#fff", async () => {
                if (confirming) return; setConfirming(e.application_id);
                const { data, error } = await supabase.rpc("confirm_start", { p_application_id: e.application_id });
                setConfirming("");
                if (error || !data?.ok) { alert("確認できませんでした：" + (data?.reason || error?.message || "不明")); return; }
                setSubMap(prev => ({ ...prev, [e.application_id]: { ...(prev[e.application_id]||{}), farmer_confirmed_start_at: new Date().toISOString() } }));
              });
            }
            // 終了打刻後（開始確認済み）＝完了して評価する。応募者ページの完了モーダルへ橋渡し（cb_completeAppId）
            if (sub.farmer_confirmed_start_at) {
              return btn("✅ 完了して評価する", accent, "#fff", () => { try { sessionStorage.setItem("cb_completeAppId", e.application_id); } catch {} window.location.hash = "/profile/employer/applicants"; });
            }
            return btn("応募者ページ", "#F7F7F7", "#222", () => { window.location.hash = handshakeHash; }, "1px solid #EBEBEB");
          })() : btn("開始・終了", accent, "#fff", () => { window.location.hash = handshakeHash; })}
          {e.application_id && btn("⚠️ 緊急連絡", "#fff", "#C77700", () => { window.location.hash = "/emergency/" + e.application_id; }, "1px solid #FFB020")}
          {e.application_id && btn("チャット", "#00A86B", "#fff", () => { window.location.hash = "/chat/" + e.application_id; })}
        </div>
      </div>
    );
  };

  // ── やること（採配台）：状態カード。①②⑧=遷移／③〜⑦=直接実行（保険・開始確認はインライン、日程決定・完了/評価は既存モーダルへ橋渡し） ──
  const removeTodo = (id, st) => setTodos(prev => prev.filter(t => !(t.application_id === id && t.stage === st)));
  const TODO_META = {
    revision:    { icon:"📝", title:"求人に修正のお願い",   btn:"修正する →",       nav: e => "/work/edit/" + e.job_number },
    approve:     { icon:"📨", title:"新着の応募",           btn:"確認して承認 →",   nav: () => "/profile/employer/applicants" },
    // decide_dates（働く日を決める）は廃止（2026-07-24たきと確定）：日程宣言なしもいつでもOKも全期間working前提。
    // 日程変更が必要な時だけ応募者ページの働く日モーダル（set_agreed_dates・cb_agreeAppId着地は温存）で行う
    insurance:   { icon:"🛡", title:"保険の準備の報告",     btn:"準備したと報告",   rpc:"confirm_insurance" },
    confirm_start:{ icon:"✓", title:"作業の開始を確認",     btn:"開始を確認",       rpc:"confirm_start" },
    complete:    { icon:"✅", title:"完了して評価する",     btn:"完了・評価 →",     flag:"cb_completeAppId", to:"/profile/employer/applicants" },
    review:      { icon:"⭐", title:"評価する",             btn:"評価する →",       flag:"cb_completeAppId", to:"/profile/employer/applicants" },
    chat:        { icon:"💬", title:"未読メッセージ",       btn:"チャットを開く →", nav: e => "/chat/" + e.application_id },
    w_waiting:   { icon:"📨", title:"返事待ち",             btn:"応募状況を見る →", nav: () => "/profile/worker/applying" },
    w_confirm:   { icon:"📋", title:"求人内容を確認",       btn:"確認カードへ →",   nav: e => "/chat/" + e.application_id },
    w_start:     { icon:"▶", title:"作業を開始する",       btn:"開始ページへ →",   nav: () => "/profile/worker/approved" },
    w_review:    { icon:"⭐", title:"終了を確認して評価",   btn:"評価ページへ →",   nav: () => "/profile/worker/approved" },
  };
  // アクションボックス（2026-07-25・プロフィール入口カードと同型）：用件（stage）ごとに絵文字ボックスを横2列配置。
  // 右上=放置数バッジ。タップで下に対象一覧（働き手アイコン＋ニックネーム＋求人チップ＋実行ボタン）が展開。
  // A案（2026-07-24たきと確定）：農家タブ＝働き手を出す／働き手タブ＝相手（農家）名は出さない（求人チップで識別）
  const todoKey = (t) => t.application_id || ("j" + t.job_number);
  const [todoOpenStage, setTodoOpenStage] = useState(null); // 展開中の用件（親に保持＝内側定義によるstate消失を回避）
  const TODO_BOX_LABEL = { insurance: "保険の報告" }; // ボックス用の短縮ラベル（未定義はm.titleのまま）
  const runTodo = async (m, e) => {
    const busyKey = (e.application_id || e.job_number) + e.stage;
    if (m.nav) { window.location.hash = m.nav(e); return; }
    if (m.flag) { try { sessionStorage.setItem(m.flag, e.application_id); } catch {} window.location.hash = m.to; return; }
    if (m.rpc) {
      if (confirming) return; setConfirming(busyKey);
      const { data, error } = await supabase.rpc(m.rpc, { p_application_id: e.application_id });
      setConfirming("");
      if (error || !data?.ok) { alert("処理に失敗しました：" + (data?.reason || error?.message || "不明")); return; }
      removeTodo(e.application_id, e.stage);
    }
  };
  const TodoStageBox = ({ stage, items }) => {
    const m = TODO_META[stage]; if (!m) return null;
    const open = todoOpenStage === stage;
    const onTapBox = () => {
      // 遷移系で1件だけなら直接遷移（余計なワンタップを挟まない）。実行系（RPC）は誤タップ防止のため必ず展開してボタンで実行
      if (items.length === 1 && (m.nav || m.flag)) { runTodo(m, items[0]); return; }
      setTodoOpenStage(prev => prev === stage ? null : stage);
    };
    return (
      <button onClick={onTapBox} className="f-sans" style={{
        position:"relative", background:"#fff", border:"1px solid " + (open ? accent : "#EBEBEB"), borderRadius:18,
        padding:"24px 10px 18px", textAlign:"center", cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.04)",
      }}>
        <span aria-label={"残り" + items.length + "件"} style={{ position:"absolute", top:10, right:10, minWidth:24, height:24, borderRadius:12, background:"#00A86B", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 7px" }}>{items.length}</span>
        <span style={{ display:"block", fontSize:40, lineHeight:1, marginBottom:10 }}>{m.icon}</span>
        <span style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>{TODO_BOX_LABEL[stage] || m.title}</span>
      </button>
    );
  };
  // 展開パネル：タップしたボックスの対象一覧（1行=誰・どの求人・実行ボタン）
  const TodoStagePanel = ({ stage, items }) => {
    const m = TODO_META[stage]; if (!m) return null;
    return (
      <div style={{ gridColumn:"1 / -1", border:"1px solid #EBEBEB", borderLeft:"4px solid " + accent, borderRadius:12, background:"#fff", padding:"12px 14px" }}>
        <p className="f-sans" style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, fontWeight:800, color:"#222", margin:"0 0 10px" }}>
          <span style={{ fontSize:16 }}>{m.icon}</span>{TODO_BOX_LABEL[stage] || m.title}
        </p>
        <div style={{ display:"grid", gap:8 }}>
          {items.map(t => {
            const busy = confirming === (t.application_id || t.job_number) + t.stage;
            const jobChip = [t.job_number ? "#" + t.job_number : "", [t.crop, t.task].filter(Boolean).join(" ")].filter(Boolean).join(" ");
            return (
              <div key={todoKey(t)} style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
                {role === "farmer" && t.partner_name ? (
                  <>
                    <Avatar url={t.partner_avatar} name={t.partner_name} size={28} bg={ROLE_ORANGE} />
                    <span className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flexShrink:1, minWidth:0 }}>{t.partner_name}さん</span>
                  </>
                ) : null}
                {jobChip && <span className="f-sans" style={{ flexShrink:1, minWidth:0, fontSize:11, fontWeight:600, color:"#717171", background:"#F7F7F7", borderRadius:8, padding:"4px 8px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{jobChip}</span>}
                <span style={{ flex:1 }} />
                <button onClick={()=>runTodo(m, t)} disabled={busy} className="f-sans" style={{ flexShrink:0, padding:"8px 12px", fontSize:12, fontWeight:700, background:accent, color:"#fff", border:"none", borderRadius:9, cursor:"pointer", whiteSpace:"nowrap", opacity: busy ? 0.6 : 1 }}>{busy ? "..." : m.btn}</button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const UpcomingRow = ({ e }) => {
    const label = e.date_end && e.date_end !== e.date_start ? `${calFmtDate(e.date_start)}〜${calFmtDate(e.date_end)}` : calFmtDate(e.date_start);
    return (
      <button onClick={()=>{ try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {} window.location.hash = "/work/job/" + e.job_number; }}
        className="f-sans" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, width:"100%", textAlign:"left", background:"#fff", border:"1px solid #F0F0F0", borderLeft:"3px solid " + accent, borderRadius:10, padding:"11px 12px", cursor:"pointer" }}>
        <span style={{ minWidth:0, overflow:"hidden" }}>
          <span style={{ display:"block", fontSize:13, fontWeight:600, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[e.crop, e.task].filter(Boolean).join(" ") || "求人"} <span style={{ color:"#999", fontWeight:700, fontSize:11 }}>#{e.job_number}</span></span>
          <span style={{ display:"block", fontSize:11, color:"#999", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>📅 {label}{e.work_time ? "　" + e.work_time : ""}{role === "farmer" && e.partner_name ? "　" + e.partner_name : ""}</span>
        </span>
        <span style={{ color:"#C8C8C8", fontSize:16, flexShrink:0 }}>›</span>
      </button>
    );
  };

  return (
    <div style={{ maxWidth:600, margin:"0 auto", padding:"8px 0 24px" }}>
      <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:"0 0 14px" }}>📆 今日</h2>
      {/* 役割タブ（両役を持つ人だけ・このページの表示だけ切替）。単役は非表示 */}
      {dual && (
        <div style={{ display:"flex", gap:8, marginBottom:18 }}>
          {[{ k:"worker", l:"働き手", c:ROLE_ORANGE }, { k:"farmer", l:"農家", c:ROLE_GREEN }].map(t => (
            <button key={t.k} onClick={()=>setRole(t.k)} className="f-sans" style={{
              padding:"7px 16px", fontSize:13, fontWeight:700, borderRadius:20, cursor:"pointer",
              background: role === t.k ? t.c : "#fff", color: role === t.k ? "#fff" : "#717171",
              border: "1px solid " + (role === t.k ? t.c : "#EBEBEB"),
            }}>{t.l}</button>
          ))}
        </div>
      )}
      {loading ? (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中...</p>
      ) : (<>
        {/* 【やること】採配台：状態カードを締切の近い順に。①②⑧=遷移／③〜⑦=直接実行。件数=今日タブのバッジ(todo)と一致 */}
        {(() => {
          // 最新順（sort_keyの新しい順・同日なら求人番号の新しい順）
          const myTodos = todos.filter(t => t.my_role === role).sort((a, b) => (b.sort_key || "").localeCompare(a.sort_key || "") || (b.job_number || 0) - (a.job_number || 0));
          if (myTodos.length === 0) return null;
          // 用件（stage）ごとに1箱へ集約（箱の並びも最新順＝各用件の最新アイテム順）
          const stageOrder = []; const byStage = new Map();
          myTodos.forEach(t => { if (!byStage.has(t.stage)) { byStage.set(t.stage, []); stageOrder.push(t.stage); } byStage.get(t.stage).push(t); });
          return (
            <div style={{ marginBottom:24 }}>
              <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 10px", borderLeft:"3px solid " + accent, paddingLeft:8 }}>やること（{myTodos.length}）</p>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:12 }}>
                {stageOrder.map(st => (
                  <Fragment key={st}>
                    <TodoStageBox stage={st} items={byStage.get(st)} />
                    {todoOpenStage === st && <TodoStagePanel stage={st} items={byStage.get(st)} />}
                  </Fragment>
                ))}
              </div>
            </div>
          );
        })()}
        <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 10px", borderLeft:"3px solid " + accent, paddingLeft:8 }}>きょうの仕事</p>
        {todayJobs.length > 0 ? (
          <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr)", gap:12, marginBottom:24 }}>
            {todayJobs.map(e => <TodayCard key={e.application_id || e.job_number} e={e} />)}
          </div>
        ) : (
          <div style={{ background:"#F7F7F7", borderRadius:14, padding:"28px 20px", textAlign:"center", marginBottom:24 }}>
            <div style={{ fontSize:36, marginBottom:8 }}>☀️</div>
            <p className="f-sans" style={{ fontSize:14, color:"#717171", margin:0 }}>きょうの仕事はありません</p>
            {upcoming.length === 0 && (
              <button onClick={()=>{ window.location.hash = "/search"; }} className="f-sans" style={{ marginTop:14, padding:"10px 22px", fontSize:13, fontWeight:700, background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, color:"#00A86B", cursor:"pointer" }}>求人をさがす →</button>
            )}
          </div>
        )}
        {upcoming.length > 0 && (
          <div style={{ marginBottom:24 }}>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 10px", borderLeft:"3px solid #DDD", paddingLeft:8 }}>つぎの予定（7日以内）</p>
            <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr)", gap:8 }}>
              {upcoming.map(e => <UpcomingRow key={e.application_id || e.job_number} e={e} />)}
            </div>
          </div>
        )}
        {/* 📝メモ（私的・端末内localStorage・本人のみ／DB非保存） */}
        <div style={{ marginBottom:24 }}>
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 10px", borderLeft:"3px solid #DDD", paddingLeft:8 }}>📝 メモ</p>
          <textarea value={memo} onChange={e=>{ setMemo(e.target.value); try { localStorage.setItem("cb_todayMemo", e.target.value); } catch {} }} placeholder="自分用のメモ（この端末だけに保存されます）" rows={3} className="field f-sans" style={{ width:"100%", fontSize:14, resize:"vertical", boxSizing:"border-box" }} />
        </div>
        <button onClick={()=>{ window.location.hash = "/calendar/month"; }} className="f-sans" style={{ display:"block", width:"100%", textAlign:"center", background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:"14px", fontSize:14, fontWeight:700, color:"#222", cursor:"pointer" }}>📅 月の予定を見る →</button>
      </>)}
    </div>
  );
}
