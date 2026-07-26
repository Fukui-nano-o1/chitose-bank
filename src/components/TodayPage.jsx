// 📆 今日ページ（分割・段階2で切り出し・2026-07-24）：ナビ4番。やること（my_todo_items）＋きょうの仕事＋つぎの予定＋メモ。
import { useState, useEffect, useRef, Fragment } from "react";
import { supabase } from "../lib/supabase";
import { ymdLocal, calAddDays, calFmtDate, ROLE_ORANGE, ROLE_GREEN, CHAT_ELIGIBLE_STATUSES, mapJobPublicRow, payLabel } from "../lib/utils";
import { Avatar } from "./ui";
// 面接の回答パネル（2026-07-25・働き手）：農家からの【面接の質問】に今日のリストからその場で返事する。
// ★モジュールレベル定義を維持すること：親（TodayPage）内で定義すると再レンダーごとに再マウントされ、
//   textareaのフォーカス・下書きが消える（LandingFlowのフォーカス消失バグと同族）
function InterviewReplyPanel({ items, accent, onAnswered }) {
  const [questions, setQuestions] = useState({}); // application_id → 最新の【面接の質問】本文
  const [drafts, setDrafts] = useState({});       // application_id → 入力中の回答
  const [sending, setSending] = useState("");
  const [jobOpen, setJobOpen] = useState({});     // application_id → 該当求人ボックスの展開状態（2026-07-25たきと指示）
  const [jobInfo, setJobInfo] = useState({});     // job_number → mapJobPublicRow整形済み（null=取得失敗・undefined=未取得）
  const toggleJob = async (t) => {
    if (!t.job_number) return;
    const next = !jobOpen[t.application_id];
    setJobOpen(prev => ({ ...prev, [t.application_id]: next }));
    if (next && !(t.job_number in jobInfo)) {
      try {
        const { data } = await supabase.from("jobs_public").select("*").eq("job_number", t.job_number).maybeSingle();
        setJobInfo(prev => ({ ...prev, [t.job_number]: data ? mapJobPublicRow(data) : null }));
      } catch { setJobInfo(prev => ({ ...prev, [t.job_number]: null })); }
    }
  };
  const idsKey = items.map(t => t.application_id).filter(Boolean).join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ids = idsKey ? idsKey.split(",") : [];
        if (!ids.length) return;
        const { data } = await supabase.from("messages")
          .select("application_id,body,created_at").in("application_id", ids)
          .like("body", "【面接の質問】%").order("created_at", { ascending: true });
        if (cancelled || !data) return;
        const q = {}; data.forEach(m => { q[m.application_id] = m.body; }); // 昇順で上書き＝各応募の最新が残る
        setQuestions(q);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [idsKey]);
  const send = async (t) => {
    const body = (drafts[t.application_id] || "").trim();
    if (!body || sending) return;
    setSending(t.application_id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSending(""); return; }
      const { error } = await supabase.from("messages").insert({ application_id: t.application_id, sender_id: session.user.id, body });
      if (error) { alert("送信に失敗しました：" + error.message); setSending(""); return; }
      setSending("");
      setDrafts(prev => ({ ...prev, [t.application_id]: "" }));
      onAnswered(t.application_id);
    } catch (e) { alert("送信に失敗しました：" + (e?.message || "不明")); setSending(""); }
  };
  return (
    <div style={{ gridColumn:"1 / -1", border:"1px solid #EBEBEB", borderRadius:12, background:"#fff", padding:"12px 14px" }}>
      {/* ボックス内タイトル・左端の役割色バーは廃止（2026-07-26たきと指示：見出しはページヘッダーが担う。TodoStagePanelと同じ整理） */}
      <div style={{ display:"grid", gap:14 }}>
        {items.map(t => (
          <div key={t.application_id} style={{ display:"grid", gap:8 }}>
            {/* 求人チップ：タップでその場に求人ボックスを展開（2026-07-25たきと指示。ページ遷移はボックス内リンクに退避） */}
            <button onClick={()=>toggleJob(t)}
              className="f-sans" style={{ justifySelf:"start", fontSize:11, fontWeight:600, color:"#717171", background:"#F7F7F7", border:"none", borderRadius:8, padding:"4px 8px", cursor:"pointer", textDecoration:"underline", textUnderlineOffset:2 }}>
              {[t.job_number ? "#" + t.job_number : "", [t.crop, t.task].filter(Boolean).join(" ")].filter(Boolean).join(" ")}{jobOpen[t.application_id] ? " ▲" : " ▼"}
            </button>
            {jobOpen[t.application_id] && (
              <div style={{ border:"1px solid #EBEBEB", borderRadius:12, background:"#FAFAFA", overflow:"hidden" }}>
                {!(t.job_number in jobInfo) ? (
                  <p className="f-sans" style={{ fontSize:12, color:"#999", textAlign:"center", padding:"14px 0", margin:0 }}>読み込み中...</p>
                ) : jobInfo[t.job_number] ? (() => {
                  const j = jobInfo[t.job_number];
                  const photo = j.photos && j.photos[0] ? (typeof j.photos[0] === "string" ? j.photos[0] : j.photos[0]?.url) : null;
                  return (
                    <>
                      <div style={{ display:"flex", gap:10, padding:"10px 12px 8px", alignItems:"center" }}>
                        <div style={{ width:48, height:48, borderRadius:8, background:"#F0F0F0", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, overflow:"hidden" }}>
                          {photo ? <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌾"}
                        </div>
                        <div style={{ minWidth:0 }}>
                          <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[j.crop, j.task].filter(Boolean).join(" ") || "求人"}</p>
                          {j.region && <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"2px 0 0" }}>📍 {j.region}</p>}
                        </div>
                      </div>
                      <div style={{ padding:"0 12px 10px", display:"grid", gap:3 }}>
                        {[["日程", j.dateLabel], ["勤務時間", j.workTime], ["休憩", j.breakTime], ["報酬", j.pay ? payLabel(j) : ""], ["人数", j.count]].filter(r => r[1]).map(r => (
                          <div key={r[0]} style={{ display:"flex", gap:10 }}>
                            <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", flexShrink:0, width:52 }}>{r[0]}</span>
                            <span className="f-sans" style={{ fontSize:12, color:"#222", fontWeight:600, minWidth:0 }}>{r[1]}</span>
                          </div>
                        ))}
                      </div>
                      <button onClick={()=>{ try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {} window.location.hash = "/work/job/" + t.job_number; }}
                        className="f-sans" style={{ display:"block", width:"100%", textAlign:"center", background:"#fff", border:"none", borderTop:"1px solid #EBEBEB", padding:"9px", fontSize:12, fontWeight:700, color:"#00A86B", cursor:"pointer" }}>求人ページを見る →</button>
                    </>
                  );
                })() : (
                  <div style={{ padding:"12px" }}>
                    <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 8px", textAlign:"center" }}>求人情報を取得できませんでした。</p>
                    <button onClick={()=>{ try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {} window.location.hash = "/work/job/" + t.job_number; }}
                      className="f-sans" style={{ display:"block", margin:"0 auto", background:"none", border:"none", fontSize:12, fontWeight:700, color:"#00A86B", textDecoration:"underline", cursor:"pointer" }}>求人ページを見る →</button>
                  </div>
                )}
              </div>
            )}
            <p className="f-sans" style={{ fontSize:12, color:"#222", lineHeight:1.7, background:"#F7F7F7", borderRadius:10, padding:"10px 12px", margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word" }}>
              {questions[t.application_id] || "質問を読み込み中..."}
            </p>
            <textarea rows={3} value={drafts[t.application_id] || ""} onChange={ev => setDrafts(prev => ({ ...prev, [t.application_id]: ev.target.value }))}
              placeholder="回答を入力（そのまま相手に届きます）" className="field f-sans" style={{ width:"100%", fontSize:14, resize:"vertical", boxSizing:"border-box" }} />
            <button onClick={()=>send(t)} disabled={sending === t.application_id || !(drafts[t.application_id] || "").trim()}
              className="f-sans" style={{ justifySelf:"end", padding:"9px 16px", fontSize:13, fontWeight:700, background:accent, color:"#fff", border:"none", borderRadius:9, cursor:"pointer", opacity: (sending === t.application_id || !(drafts[t.application_id] || "").trim()) ? 0.5 : 1 }}>
              {sending === t.application_id ? "..." : "返事を送る"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// #/calendar：ナビ4番「📆 今日」。きょうの契約済み仕事＋つぎの予定（向こう7日）。月カレンダーは奥（#/calendar/month）。
// 両役（働き手・農家）を持つ人だけ役割タブを出す。タブはこのページの表示だけを切替（全体モードは変えない）。
export function TodayPage({ me, defaultRole }) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  const [hasWorker, setHasWorker] = useState(false);
  const [hasFarmer, setHasFarmer] = useState(false);
  const [role, setRole] = useState(defaultRole === "farmer" ? "farmer" : "worker");
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
  // きょうの仕事の分解（2026-07-25たきと指示・同日改定）：1箱でなく役割ごとの箱に分ける。
  // 確認カード（現場情報）／緊急連絡（当日の遅刻・欠勤・中止）／きょうのチャット（相手との連絡）
  const tCard = todayJobs.map(e => ({ ...e, stage: "t_card" }));
  const tEmergency = todayJobs.filter(e => e.application_id).map(e => ({ ...e, stage: "t_emergency" }));
  const todayStageItems = (st) => st === "t_card" ? tCard : st === "t_emergency" ? tEmergency : null; // t_chatは削除（2026-07-25）
  const upcoming = mine
    .filter(e => e.date_start && e.date_start > todayYmd && e.date_start <= in7Ymd)
    .sort((a, b) => (a.date_start || "").localeCompare(b.date_start || "") || (a.work_time || "").localeCompare(b.work_time || ""));
  const dual = hasWorker && hasFarmer;
  // 横スワイプで働き手⇄農家（雇い手）を切替（両役持ちのみ・2026-07-25）。
  // なめらか化（同日改修）：①追従はsetStateせずDOMのtransformを直接書く（毎フレーム再レンダーを排除）
  // ②ジェスチャ開始8pxで縦/横を1回だけ判定する方向ロック（縦と誤認識しない）
  // ③容器にtouch-action:pan-y＋横ロック中はpreventDefault（縦スクロールとの奪い合いを断つ。ReactのonTouchMoveは
  //   passiveでpreventDefault不可のため、ネイティブリスナーを{passive:false}で張る）
  const rootRef = useRef(null);
  const contentRef = useRef(null);
  const gestureRef = useRef(null); // { x, y, lock:'h'|'v'|null }
  const roleRef = useRef(role); roleRef.current = role;
  const dualRef = useRef(dual); dualRef.current = dual;
  const [slideDir, setSlideDir] = useState(0); // 切替後のスライドイン方向（1=右から・-1=左から）
  const [slideKey, setSlideKey] = useState(0); // key更新でアニメを再生
  const switchRole = (target) => {
    if (target === roleRef.current) return;
    setSlideDir(target === "farmer" ? 1 : -1); // タブ並び：左=働き手・右=農家
    setSlideKey(k => k + 1);
    setRole(target);
  };
  const switchRoleRef = useRef(switchRole); switchRoleRef.current = switchRole;
  useEffect(() => {
    const el = rootRef.current; if (!el) return;
    const onStart = (ev) => { const t = ev.touches[0]; if (t) gestureRef.current = { x: t.clientX, y: t.clientY, lock: null }; };
    const onMove = (ev) => {
      const g = gestureRef.current; if (!g || !dualRef.current) return;
      const t = ev.touches[0]; if (!t) return;
      const dx = t.clientX - g.x, dy = t.clientY - g.y;
      if (!g.lock) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // 8px動くまで判定保留
        g.lock = Math.abs(dx) > Math.abs(dy) ? "h" : "v";  // 1ジェスチャ1回だけ軸を確定
      }
      if (g.lock !== "h") return; // 縦確定＝以後ノータッチ（ブラウザのスクロールに完全に譲る）
      ev.preventDefault();
      const c = contentRef.current; if (!c) return;
      const target = dx < 0 ? "farmer" : "worker";
      const damp = target === roleRef.current ? 0.12 : 0.4; // 行き先が無い方向は強い抵抗（端の感触）
      c.style.transition = "none";
      c.style.transform = `translateX(${Math.max(-100, Math.min(100, dx * damp))}px)`;
    };
    const onEnd = (ev) => {
      const g = gestureRef.current; gestureRef.current = null;
      if (!g || g.lock !== "h") return;
      const c = contentRef.current;
      const t = ev.changedTouches && ev.changedTouches[0];
      const dx = t ? t.clientX - g.x : 0;
      const target = dx < 0 ? "farmer" : "worker";
      if (Math.abs(dx) >= 50 && target !== roleRef.current) {
        if (c) { c.style.transition = ""; c.style.transform = ""; }
        switchRoleRef.current(target); // key更新で新コンテンツがスライドイン
        return;
      }
      if (c) { c.style.transition = "transform .2s ease"; c.style.transform = ""; } // スナップバック
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);
  const accent = role === "worker" ? ROLE_ORANGE : ROLE_GREEN;

  // TodayCardコンポーネントは削除（2026-07-25統合）：役割はstage="today"の行（チャット主ボタン・⚠️緊急連絡・求人チップ）へ

  // ── やること（採配台）：状態カード。①②⑧=遷移／③〜⑦=直接実行（保険・開始確認はインライン、日程決定・完了/評価は既存モーダルへ橋渡し） ──
  const removeTodo = (id, st) => setTodos(prev => prev.filter(t => !(t.application_id === id && t.stage === st)));
  const TODO_META = {
    // きょうの仕事の分解（2026-07-25）：役割ごとの箱。1件なら即遷移（各箱の機能が単一so迷いなし）
    t_card:      { icon:"📋", title:"確認カード",           btn:"確認カード →",     nav: e => { try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {} return "/work/job/" + e.job_number; } },
    t_emergency: { icon:"⚠️", title:"緊急連絡",             btn:"緊急連絡 →",       nav: e => "/emergency/" + e.application_id },
    // t_chat（きょうのチャット）・chat（未読メッセージ）は削除（2026-07-25たきと指示・両役割）：
    // 未読の案内は下部ナビ「チャット」タブのバッジ＋プッシュ通知＋トーストが担い、今日は自分のアクションだけに絞る
    revision:    { icon:"📝", title:"求人に修正のお願い",   btn:"修正する →",       nav: e => "/work/edit/" + e.job_number },
    approve:     { icon:"📨", title:"新着の応募",           btn:"確認して承認 →",   nav: () => "/profile/employer/applicants" },
    // decide_dates（働く日を決める）は廃止（2026-07-24たきと確定）：日程宣言なしもいつでもOKも全期間working前提。
    // 日程変更が必要な時だけ応募者ページの働く日モーダル（set_agreed_dates・cb_agreeAppId着地は温存）で行う
    // interview/hire（2026-07-25たきと指示）：チャットの質問集シート・採用ボタンを今日のリストへ移設。
    // チャットは「アクションの報告（自動送信）＋直接やりとりが必要な時だけ」の最小役割に寄せていく
    interview:   { icon:"❓", title:"面接の質問を送る",     btn:"質問を送る →",     qset:true },
    hire:        { icon:"🤝", title:"採用する",             btn:"採用する",         hire:true },
    insurance:   { icon:"🛡", title:"保険の準備の報告",     btn:"準備したと報告",   rpc:"confirm_insurance" },
    confirm_start:{ icon:"✓", title:"作業の開始を確認",     btn:"開始を確認",       rpc:"confirm_start" },
    // review（評価する）はcompleteへ統合（2026-07-25たきと指示）：完了記録がまだ／評価だけ残り（3日以内）の
    // 両方をmy_todo_itemsが'complete'として返す。行き先は同じ完了モーダル（完了記録→評価の一連）
    complete:    { icon:"✅", title:"完了して評価する",     btn:"完了・評価 →",     flag:"cb_completeAppId", to:"/profile/employer/applicants" },
    // w_waiting（返事待ち）は廃止（2026-07-25たきと指示）：やることリストは当人のアクションが前提。
    // 返事待ちは相方（農家）のアクション待ち＝思想が違う。応募状況の確認は応募状況ページが担う
    // w_confirm（求人内容の確認）は廃止（2026-07-25たきと指示）：内容を確認した上で応募するのが前提。
    // 応募INSERT時にterms_confirmed_worker_atをDBトリガーが自動記録。日程の申請（チャットの候補日）は残す
    w_interview: { icon:"✍️", title:"面接の回答",           btn:"返事する" }, // 農家の【面接の質問】にここで返事（専用パネル・返信はチャットにも残る）
    w_start:     { icon:"▶", title:"作業を開始する",       btn:"開始ページへ →",   nav: () => "/profile/worker/approved" },
    w_review:    { icon:"⭐", title:"終了を確認して評価",   btn:"評価ページへ →",   nav: () => "/profile/worker/approved" },
  };
  // アクションボックス（2026-07-25・プロフィール入口カードと同型）：用件（stage）ごとに絵文字ボックスを横2列配置。
  // 右上=放置数バッジ。タップで下に対象一覧（働き手アイコン＋ニックネーム＋求人チップ＋実行ボタン）が展開。
  // A案（2026-07-24たきと確定）：農家タブ＝働き手を出す／働き手タブ＝相手（農家）名は出さない（求人チップで識別）
  const todoKey = (t) => t.application_id || ("j" + t.job_number);
  // 用件ごとの専用ページ（2026-07-25たきと指示）：#/calendar/todo/{stage}。ボックスタップで遷移・←で今日へ戻る
  const readTodoStage = () => { const mt = window.location.hash.replace(/^#\/?/, "").match(/^calendar\/todo\/([a-z_]+)$/); return mt ? mt[1] : null; };
  const [pageStage, setPageStage] = useState(readTodoStage());
  useEffect(() => {
    const on = () => setPageStage(readTodoStage());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  // 面接の回答を送信してリストが空になった時は「送信完了しました。」を出す（2026-07-26たきと指示。ページを離れたらリセット）
  const [answeredDone, setAnsweredDone] = useState(false);
  useEffect(() => { setAnsweredDone(false); }, [pageStage]);
  const TODO_BOX_LABEL = { insurance: "保険の報告", interview: "面接する", revision: "求人の修正" }; // ボックス用の短縮ラベル（未定義はm.titleのまま。hireはタイトル「採用する」をそのまま表示）
  // 役割ごとの全用件カタログ（ボックスは常時表示。該当ありは上位・該当なしは薄く下位に並ぶ。並びは正規フロー順）
  const TODO_STAGE_CATALOG = {
    farmer: ["t_card", "t_emergency", "revision", "approve", "interview", "hire", "insurance", "confirm_start", "complete"],
    worker: ["t_card", "t_emergency", "w_interview", "w_start", "w_review"],
  };
  // 専用ページを開いたら役割をその用件側へ合わせる（accent・パネルの表示条件が追従）
  useEffect(() => {
    if (!pageStage) return;
    if (pageStage.startsWith("t_")) return; // きょうの仕事系は両役共通＝現在の役割のまま
    const pr = TODO_STAGE_CATALOG.worker.includes(pageStage) ? "worker" : "farmer";
    if (role !== pr) setRole(pr);
  }, [pageStage, role]);
  // 採用時の二重予約チェック（ChatViewから移植・2026-07-25）：同じ働き手が自分の別の進行中求人で日程重複していないか
  const hireDoubleBookingCheck = async (e) => {
    try {
      if (!e.partner_id || !e.job_number || !e.date_start) return null;
      const { data: { session } } = await supabase.auth.getSession(); if (!session) return null;
      const { data: apps } = await supabase.from("applications")
        .select("job_number,status").eq("farmer_id", session.user.id).eq("worker_id", e.partner_id).neq("job_number", e.job_number);
      const others = (apps || []).filter(a => CHAT_ELIGIBLE_STATUSES.includes(a.status) && a.job_number != null);
      if (!others.length) return null;
      const { data: jrows } = await supabase.from("jobs").select("job_number,date_start,date_end").in("job_number", [...new Set(others.map(a => a.job_number))]);
      const curEnd = e.date_end || e.date_start;
      for (const j of jrows || []) {
        if (!j.date_start) continue;
        const jEnd = j.date_end || j.date_start;
        if (e.date_start <= jEnd && j.date_start <= curEnd) return j.job_number;
      }
    } catch {}
    return null;
  };
  const runTodo = async (m, e) => {
    const busyKey = (e.application_id || e.job_number) + e.stage;
    if (m.nav) { window.location.hash = m.nav(e); return; }
    if (m.flag) { try { sessionStorage.setItem(m.flag, e.application_id); } catch {} window.location.hash = m.to; return; }
    // 面接の質問（チャットからの移設）：チャットに着地して質問集シートを自動で開く（回答は面接の証跡としてチャットに残る）
    if (m.qset) { try { sessionStorage.setItem("cb_openQSet", "1"); } catch {} window.location.hash = "/chat/" + e.application_id; return; }
    // 採用する（チャットの採用ボタンの移設）：二重予約警告＋確認→confirm_terms。採用通知はDBトリガーが自動送信
    if (m.hire) {
      if (confirming) return; setConfirming(busyKey);
      const dup = await hireDoubleBookingCheck(e);
      const warn = dup ? `⚠️ この働き手さんは、日程が重なる別の求人 #${dup} にも進んでいます。\n同じ日に別の仕事（二重予約）になっていないか確認してください。\n\n` : "";
      if (!window.confirm(warn + `${e.partner_name ? e.partner_name + "さん" : "この方"}を #${e.job_number} に採用しますか？\n面接を終えてから決定してください。`)) { setConfirming(""); return; }
      const { data, error } = await supabase.rpc("confirm_terms", { p_application_id: e.application_id });
      setConfirming("");
      if (error || !data?.ok) { alert("処理に失敗しました：" + (data?.reason || error?.message || "不明")); return; }
      // 採用が決まったら「面接の質問」の用事も同時に消える（採用前限定の段のため）
      setTodos(prev => prev.filter(t => !(t.application_id === e.application_id && (t.stage === "hire" || t.stage === "interview"))));
      return;
    }
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
    const n = items.length;
    const onTapBox = () => {
      if (!n) return; // 該当なしボックスは表示のみ（何の用事が来うるかの地図）
      // 遷移系で1件だけなら直接遷移（余計なワンタップを挟まない）。それ以外は用件の専用ページへ
      if (n === 1 && (m.nav || m.flag)) { runTodo(m, items[0]); return; }
      window.location.hash = "/calendar/todo/" + stage;
    };
    return (
      <button onClick={onTapBox} disabled={!n} className="f-sans" style={{
        position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:18,
        padding:"24px 10px 18px", textAlign:"center", cursor: n ? "pointer" : "default", boxShadow:"0 1px 4px rgba(0,0,0,0.04)",
        opacity: n ? 1 : 0.45,
      }}>
        {n > 0 && <span aria-label={"残り" + n + "件"} style={{ position:"absolute", top:10, right:10, minWidth:24, height:24, borderRadius:12, background:"#00A86B", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 7px" }}>{n}</span>}
        <span style={{ display:"block", fontSize:40, lineHeight:1, marginBottom:10 }}>{m.icon}</span>
        <span style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>{TODO_BOX_LABEL[stage] || m.title}</span>
      </button>
    );
  };
  // 展開パネル：タップしたボックスの対象一覧（1行=誰・どの求人・実行ボタン）
  // ボックス内タイトル・左端の役割色バーは廃止（2026-07-26たきと指示：見出しはページヘッダーが担う・属性分け不要）
  const TodoStagePanel = ({ stage, items }) => {
    const m = TODO_META[stage]; if (!m) return null;
    return (
      <div style={{ gridColumn:"1 / -1", border:"1px solid #EBEBEB", borderRadius:12, background:"#fff", padding:"12px 14px" }}>
        <div style={{ display:"grid", gap:8 }}>
          {items.map(t => {
            const busy = confirming === (t.application_id || t.job_number) + t.stage;
            const jobChip = [t.job_number ? "#" + t.job_number : "", [t.crop, t.task].filter(Boolean).join(" "), (stage.startsWith("t_") && t.work_time) ? "🕒" + t.work_time : ""].filter(Boolean).join(" ");
            return (
              <div key={todoKey(t)} style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
                {role === "farmer" && t.partner_name ? (
                  /* ニックネームはアイコンの下（2026-07-26たきと指示） */
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, flexShrink:0, maxWidth:64 }}>
                    <Avatar url={t.partner_avatar} name={t.partner_name} size={36} bg={ROLE_ORANGE} />
                    <span className="f-sans" style={{ fontSize:10, fontWeight:700, color:"#222", maxWidth:64, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.partner_name}さん</span>
                  </div>
                ) : null}
                {/* 求人チップはタップで求人ページへ（確認前に内容を見られる） */}
                {jobChip && <button onClick={()=>{ if (!t.job_number) return; try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {} window.location.hash = "/work/job/" + t.job_number; }} className="f-sans" style={{ flexShrink:1, minWidth:0, fontSize:11, fontWeight:600, color:"#717171", background:"#F7F7F7", border:"none", borderRadius:8, padding:"4px 8px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", cursor:"pointer", textDecoration:"underline", textUnderlineOffset:2 }}>{jobChip}</button>}
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

  // ── 用件の専用ページ（#/calendar/todo/{stage}）：ボックスタップの行き先。←で今日へ戻る ──
  if (pageStage && TODO_META[pageStage]) {
    const pm = TODO_META[pageStage];
    const pItems = todayStageItems(pageStage) || todos.filter(t => t.stage === pageStage);
    return (
      <div style={{ maxWidth:600, margin:"0 auto", padding:"8px 0 24px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, margin:"0 0 16px" }}>
          <button onClick={()=>{ window.location.hash = "/calendar"; }} aria-label="今日へ戻る" className="f-sans" style={{ background:"none", border:"none", color:"#717171", fontSize:20, cursor:"pointer", padding:"4px 6px", lineHeight:1 }}>←</button>
          <h2 className="f-sans" style={{ display:"flex", alignItems:"center", gap:8, fontSize:18, fontWeight:800, color:"#222", margin:0, flex:1, minWidth:0 }}>
            <span style={{ fontSize:20 }}>{pm.icon}</span>{TODO_BOX_LABEL[pageStage] || pm.title}
          </h2>
          {/* 件数バッジは廃止（2026-07-26たきと指示：ページ内で通知は不要。件数は今日ページのボックスが示す） */}
        </div>
        {loading ? (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中...</p>
        ) : pItems.length === 0 ? (
          <div style={{ background:"#F7F7F7", borderRadius:14, padding:"28px 20px", textAlign:"center" }}>
            <div style={{ fontSize:32, marginBottom:8 }}>✅</div>
            <p className="f-sans" style={{ fontSize:14, color:"#717171", margin:0 }}>{answeredDone ? "送信完了しました。" : "この用事はいまありません"}</p>
          </div>
        ) : pageStage === "w_interview" ? (
          <InterviewReplyPanel items={pItems} accent={accent} onAnswered={(id)=>{ removeTodo(id, "w_interview"); setAnsweredDone(true); }} />
        ) : (
          <TodoStagePanel stage={pageStage} items={pItems} />
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} style={{ maxWidth:600, margin:"0 auto", padding:"8px 0 24px", overflowX:"hidden", touchAction:"pan-y" }}>
      {/* 見出し「📆 今日」は削除（2026-07-26たきと指示）。現在地は下部ナビの点灯が示すため冗長 */}
      {/* 役割タブ（両役を持つ人だけ・このページの表示だけ切替）。単役は非表示。
          構造は求人タブ（作成中⇄公開中）と同型＝横幅いっぱい均等・白地・選択中は太枠＋太字
          （2026-07-26たきと指示）。枠色のみ役割カラー（目印限定の既定・黒でなく橙/緑） */}
      {dual && (
        <div style={{ display:"flex", gap:8, margin:"0 0 16px" }}>
          {[{ k:"worker", l:"働き手", c:ROLE_ORANGE }, { k:"farmer", l:"農家", c:ROLE_GREEN }].map(t => (
            <button key={t.k} onClick={()=>switchRole(t.k)} className="f-sans" style={{
              flex:1, padding:"11px 0", borderRadius:12, cursor:"pointer", background:"#fff",
              border: role === t.k ? "2px solid " + t.c : "1px solid #EBEBEB",
              fontSize:14, fontWeight: role === t.k ? 800 : 600,
              color: role === t.k ? t.c : "#999",
            }}>{t.l}</button>
          ))}
        </div>
      )}
      {/* 役割コンテンツ：ドラッグ追従はcontentRefへのtransform直書き（再レンダーなし）。切替成立時はkey更新でスライドイン再生 */}
      <div key={slideKey} ref={contentRef} style={{
        animation: slideDir ? `${slideDir > 0 ? "cbSlideInR" : "cbSlideInL"} .28s ease` : undefined,
      }}>
      {loading ? (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中...</p>
      ) : (<>
        {/* 【やること】採配台：状態カードを締切の近い順に。①②⑧=遷移／③〜⑦=直接実行。件数=今日タブのバッジ(todo)と一致 */}
        {(() => {
          // 最新順（sort_keyの新しい順・同日なら求人番号の新しい順）
          const myTodos = todos.filter(t => t.my_role === role).sort((a, b) => (b.sort_key || "").localeCompare(a.sort_key || "") || (b.job_number || 0) - (a.job_number || 0));
          // 用件（stage）ごとに1箱へ集約。該当ありは最新順で上位、該当なしもカタログ順で常時表示（薄表示・タップ不可）
          const activeOrder = []; const byStage = new Map();
          [["t_card", tCard], ["t_emergency", tEmergency]].forEach(([st, arr]) => { if (arr.length) { byStage.set(st, arr); activeOrder.push(st); } }); // きょうの仕事系は常に先頭（t_chatは削除・2026-07-25）
          myTodos.forEach(t => { if (!byStage.has(t.stage)) { byStage.set(t.stage, []); activeOrder.push(t.stage); } byStage.get(t.stage).push(t); });
          const catalog = TODO_STAGE_CATALOG[role] || [];
          const stageOrder = [...activeOrder, ...catalog.filter(st => !byStage.has(st))];
          return (
            <div style={{ marginBottom:24 }}>
              <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 10px", borderLeft:"3px solid " + accent, paddingLeft:8 }}>やること（{myTodos.length}）</p>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:12 }}>
                {stageOrder.map(st => <TodoStageBox key={st} stage={st} items={byStage.get(st) || []} />)}
              </div>
            </div>
          );
        })()}
        {/* きょうの仕事の独立セクションは廃止（2026-07-25たきと指示）：stage="today"としてやることの箱へ統合。
            仕事がない日の「求人をさがす」導線だけ残す */}
        {todayJobs.length === 0 && upcoming.length === 0 && (
          <div style={{ textAlign:"center", marginBottom:24 }}>
            <button onClick={()=>{ window.location.hash = "/search"; }} className="f-sans" style={{ padding:"10px 22px", fontSize:13, fontWeight:700, background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, color:"#00A86B", cursor:"pointer" }}>求人をさがす →</button>
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
    </div>
  );
}
