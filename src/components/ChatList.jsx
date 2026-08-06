// 分割3-B（2026-07-25）：App.jsxから移動。チャット一覧＋運営DMポップアップ＋通知オンバナー。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { chatCache } from "../lib/chatCache";
import { openEmployerPreview, openWorkerPreview, openPhaseInfo } from "../lib/previewBus";
import { AutoSkeleton, useSkeletonProbe } from "./ui";
import { pushStatus, enablePush } from "../lib/push";
import { fmtJstShort, ROLE_ORANGE, ROLE_GREEN, CHAT_LIST_STATUSES, appPhaseKey, APP_PHASE_LABEL, APP_PHASE_COLOR } from "../lib/utils";
import { Avatar, LinkifiedText } from "./ui";

// チャット一覧の直近スナップショット（2026-07-22）：チャットから戻った時にスピナーを出さず即表示し、
// 裏で静かに更新する（リロード感の解消）。モジュールレベルなので再マウントをまたいで生き残る
export function ChatList() {
  const [rows, setRows] = useState(() => chatCache.v?.rows || []);
  const [loading, setLoading] = useState(() => !chatCache.v); // キャッシュがあれば最初からスピナーを出さない
  // 仮配置の骨を測るref（このページが実際に描いた形が、次回の読み込み中の形になる）
  const skelRef = useSkeletonProbe("chats");
  // 運営DM（2026-07-16）：チャット最上部の固定タブ。運営からのメッセージ閲覧＋返信（admin_messages・本人スレのみRLS）
  const [dmOpen, setDmOpen] = useState(false);
  const [dmMsgs, setDmMsgs] = useState([]);
  const [dmUnread, setDmUnread] = useState(0);
  const [dmText, setDmText] = useState("");
  const [dmSending, setDmSending] = useState(false);
  const [unreadMap, setUnreadMap] = useState(() => chatCache.v?.unreadMap || {}); // { application_id: 未読数 }（my_unread_message_counts・2026-07-17）
  const [initialsMap, setInitialsMap] = useState(() => chatCache.v?.initialsMap || {}); // { partner_auth_id: メール頭文字2文字 }（ニックネーム未設定時のアイコン・2026-07-22）
  // アクション順（2026-07-27たきと指示・同日改定）：並びの既定は「利用者が最後にアクションした順」。
  // アクション＝メッセージの送受信＋応募の記録（応募・承認/見送り・採用・保険報告・開始・完了・終了確認）。
  // ★チャットを開いただけ（既読＝read_at・chat_reads）は動かさない＝アクションではない（記録の憲法）
  const APP_ACTION_COLS = ["created_at","decided_at","status_changed_at","terms_confirmed_worker_at","terms_confirmed_farmer_at",
    "insurance_prepared_at","started_at","farmer_confirmed_start_at","work_completed_at","worker_confirmed_end_at"];
  const [lastMsgMap, setLastMsgMap] = useState(() => chatCache.v?.lastMsgMap || {}); // { application_id: 最終メッセージのcreated_at }
  const refreshLastMsg = async (ids) => {
    try {
      const list = ids && ids.length ? ids : Object.keys(lastMsgMap);
      if (!list.length) return;
      // 降順で取り、application_idごとの初出＝そのスレッドの最終メッセージ時刻
      const { data } = await supabase.from("messages").select("application_id,created_at")
        .in("application_id", list).order("created_at", { ascending: false }).limit(1000);
      if (!data) return;
      const m = {};
      data.forEach(r => { if (!m[r.application_id]) m[r.application_id] = r.created_at; });
      setLastMsgMap(m);
    } catch { /* 取得できなければ応募日順のまま（並びが壊れるより安全） */ }
  };
  // プッシュ通知の状態（2026-07-19）：チャット一覧の上に「通知をオンにする」を出す
  const [pushSt, setPushSt] = useState(null); // 'unsupported'|'need-standalone'|'default'|'denied'|'granted'
  const [pushBusy, setPushBusy] = useState(false);
  const [pushDismissed, setPushDismissed] = useState(() => { try { return localStorage.getItem("cb_pushBannerDismissed") === "1"; } catch { return false; } });
  useEffect(() => { pushStatus().then(setPushSt); }, []);
  const doEnablePush = async () => {
    setPushBusy(true);
    const r = await enablePush();
    setPushBusy(false);
    if (r.ok) { setPushSt("granted"); }
    else if (r.reason === "need-standalone") { alert("iPhoneでは、まず「ホーム画面に追加」してから、追加したアイコンで開いて通知をオンにしてください。"); }
    else if (r.reason === "denied") { alert("通知がブロックされています。端末の設定からこのアプリの通知を許可してください。"); setPushSt("denied"); }
    else { alert("通知をオンにできませんでした。時間をおいてお試しください。"); }
  };
  const dmUid = useRef(null);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.rpc("my_unread_message_counts");
        if (data) setUnreadMap(data.by_application || {});
      } catch {}
      // ニックネーム未設定の相手のアイコン用に、メール頭文字2文字を取得（メール本体はサーバー側で伏せる・2026-07-22）
      try {
        const { data } = await supabase.rpc("my_chat_partner_initials");
        if (data) setInitialsMap(data);
      } catch {}
    })();
  }, []);
  const loadDm = async (markRead) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      dmUid.current = session.user.id;
      const { data } = await supabase.from("admin_messages").select("*").eq("user_id", session.user.id).order("created_at", { ascending: true });
      setDmMsgs(data || []);
      const unread = (data || []).filter(m => m.from_admin && !m.read_at).length;
      setDmUnread(unread);
      if (markRead && unread > 0) {
        await supabase.from("admin_messages").update({ read_at: new Date().toISOString() }).eq("user_id", session.user.id).eq("from_admin", true).is("read_at", null);
        setDmUnread(0);
        window.dispatchEvent(new Event("cb:unreadRefresh"));
      }
    } catch {}
  };
  useEffect(() => { loadDm(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // リアルタイム（2026-07-19）：チャット一覧を開いている間、新着を購読して一覧の未読数と運営DMを即時更新。
  // 配信はRLS準拠（自分の当事者チャット・自分宛DMのみ）。DMポップアップを開いていれば既読化も走る
  const dmOpenRef = useRef(false);
  useEffect(() => { dmOpenRef.current = dmOpen; }, [dmOpen]);
  useEffect(() => {
    const refreshUnreadMap = async () => {
      try {
        const { data } = await supabase.rpc("my_unread_message_counts");
        if (data) setUnreadMap(data.by_application || {});
      } catch {}
    };
    // 新着メッセージのINSERTでは、その応募の最終メッセージ時刻も更新する＝返信順が即座に入れ替わる（2026-07-27）
    const onNewMsg = (payload) => {
      refreshUnreadMap();
      const m = payload?.new;
      if (m?.application_id && m?.created_at) setLastMsgMap(prev => ({ ...prev, [m.application_id]: m.created_at }));
    };
    // 応募のアクション（承認・採用・保険報告・開始・完了・終了確認）で並びが動くよう、
    // applicationsのUPDATEも購読して手元の行を差し替える（2026-07-27・アクション順）
    const onAppUpdate = (payload) => {
      const a = payload?.new; if (!a?.id) return;
      setRows(prev => (prev || []).map(x => x.id === a.id ? { ...x, ...a } : x));
    };
    const ch = supabase.channel("chatlist-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, onNewMsg)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_messages" }, () => loadDm(dmOpenRef.current))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "applications" }, onAppUpdate)
      .subscribe();
    // 復帰時の再読込＋保険ポーリング（2026-07-27たきと指示）：iOS PWAのバックグラウンドで
    // WebSocketが凍結・切断されるため、画面復帰で未読を即再取得＋表示中は10秒ごとの保険
    const onWake = () => { if (document.visibilityState === "visible") { refreshUnreadMap(); loadDm(dmOpenRef.current); } };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    const iv = setInterval(() => { if (document.visibilityState === "visible") refreshUnreadMap(); }, 10000);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      clearInterval(iv);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sendDm = async () => {
    const body = dmText.trim();
    if (!body || dmSending || !dmUid.current) return;
    setDmSending(true);
    const { error } = await supabase.from("admin_messages").insert({ user_id: dmUid.current, from_admin: false, body });
    if (error) alert("送信に失敗しました：" + error.message);
    else { setDmText(""); await loadDm(false); }
    setDmSending(false);
  };
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const uid = session.user.id;
        const [{ data: asWorker }, { data: asFarmer }] = await Promise.all([
          supabase.from("applications").select("*").eq("worker_id", uid).in("status", CHAT_LIST_STATUSES),
          supabase.from("applications").select("*").eq("farmer_id", uid).in("status", CHAT_LIST_STATUSES),
        ]);
        // worker_id===farmer_id（自分の求人に自分で応募したテストデータ等）で同一行が
        // 両方のクエリに一致するケースがあるため、id基準で重複排除する
        const byId = new Map();
        [...(asWorker || []).map(a => ({ ...a, _role: "worker" })),
         ...(asFarmer || []).map(a => ({ ...a, _role: "farmer" }))]
          .forEach(a => { if (!byId.has(a.id)) byId.set(a.id, a); });
        const all = [...byId.values()];
        if (cancelled) return;
        if (all.length === 0) { setRows([]); setLoading(false); return; }

        const farmerIds = [...new Set(all.filter(a => a._role === "worker").map(a => a.farmer_id).filter(Boolean))];
        const workerIds = [...new Set(all.filter(a => a._role === "farmer").map(a => a.worker_id).filter(Boolean))];
        const jobNumbers = [...new Set(all.map(a => a.job_number).filter(Boolean))];

        const [epRes, wpRes, jobRes] = await Promise.all([
          farmerIds.length ? supabase.from("employer_profiles_public").select("auth_id,nickname,avatar_url").in("auth_id", farmerIds) : Promise.resolve({ data: [] }),
          workerIds.length ? supabase.from("worker_profiles").select("auth_id,nickname,avatar_url").in("auth_id", workerIds) : Promise.resolve({ data: [] }),
          jobNumbers.length ? supabase.from("jobs_public").select("job_number,crop,task").in("job_number", jobNumbers) : Promise.resolve({ data: [] }),
        ]);
        if (cancelled) return;
        const epMap = {}; (epRes.data || []).forEach(e => { epMap[e.auth_id] = e; });
        const wpMap = {}; (wpRes.data || []).forEach(w => { wpMap[w.auth_id] = w; });
        const jobMap = {}; (jobRes.data || []).forEach(j => { jobMap[j.job_number] = j; });

        const merged = all
          .map(a => {
            const partner = a._role === "worker" ? epMap[a.farmer_id] : wpMap[a.worker_id];
            return {
              ...a,
              partnerName: partner?.nickname || "",
              partnerAvatar: partner?.avatar_url || "",
              job: jobMap[a.job_number] || null,
            };
          })
          .sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
        // 求人（応募）ごとに1スレッド（2026-07-23）：相手で束ねず、求人ごとに分ける。
        // terms_snapshot（契約内容）の混同を防ぐため。未読・遷移先とも応募単位。
        setRows(merged.map(a => ({ ...a, _appIds: [a.id], _count: 1 })));
        refreshLastMsg(merged.map(a => a.id)); // 返信順の材料（最終メッセージ時刻）
      } catch {}
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // 一覧スナップショットの保存（2026-07-22）：初回ロード完了後、rows/未読/イニシャルが変わるたびキャッシュへ。
  // チャットから戻った再マウントで即表示され、スピナー（リロード感）が出なくなる
  useEffect(() => { if (!loading) chatCache.v = { rows, unreadMap, initialsMap, lastMsgMap }; }, [rows, unreadMap, initialsMap, lastMsgMap, loading]);

  // 並び（2026-07-27たきと指示・同日改定）：①未読があるスレッドを先頭 ②未読同士・既読同士とも
  // 「アクション順」＝最後のアクションが新しい順（未読が2件以上でも最新順で並ぶ）。
  // メッセージも記録も無ければ応募日（created_at＝応募というアクション）で代用。
  // ★チャットを開いただけでは動かない（既読はアクションに数えない）
  // unreadMap/lastMsgMapはリアルタイムで変わるので、rowsに焼き込まず描画時に並べ替える
  const rowUnreadOf = (a) => (a._appIds || [a.id]).reduce((s, id) => s + (unreadMap[id] || 0), 0);
  // その応募の最後のアクション時刻＝メッセージの最新 と 記録された行動の時刻 の大きい方（既読は含めない）
  const rowLastAt = (a) => {
    const times = [
      ...(a._appIds || [a.id]).map(id => lastMsgMap[id]),
      ...APP_ACTION_COLS.map(c => a[c]),
    ].filter(Boolean).map(t => new Date(t).getTime()).filter(n => !isNaN(n));
    return times.length ? Math.max(...times) : 0;
  };
  const sortedRows = [...rows].sort((x, y) => {
    const ux = rowUnreadOf(x) > 0 ? 1 : 0;
    const uy = rowUnreadOf(y) > 0 ? 1 : 0;
    if (ux !== uy) return uy - ux;
    return rowLastAt(y) - rowLastAt(x);
  });

  return (
    <div style={{ maxWidth:600, margin:"0 auto", padding:"5px 0 8px" }}>{/* 上余白はmainの10px＋ここ5px＝15px固定（2026-07-25たきと指示） */}
      {/* 見出し「チャット」は削除（2026-07-27たきと指示）：下部ナビで現在地が分かる＝重複。
          上の空白は15px固定のまま（main 10px＋この箱 5px） */}
      {/* 通知をオンにする案内（2026-07-19）：未許可かつ対応環境のみ。granted/denied/未対応では出さない */}
      {!pushDismissed && (pushSt === "default" || pushSt === "need-standalone") && (
        <div className="f-sans" style={{ display:"flex", alignItems:"center", gap:12, background:"#F0F7F4", border:"1px solid #CDE9DD", borderRadius:12, padding:"12px 14px", marginBottom:10 }}>
          <span style={{ fontSize:22, flexShrink:0 }}>🔔</span>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontSize:13, fontWeight:700, color:"#222", margin:0 }}>メッセージの通知を受け取る</p>
            <p style={{ fontSize:12, color:"#5B7B6D", margin:"2px 0 0", lineHeight:1.6 }}>{pushSt === "need-standalone" ? "「ホーム画面に追加」したアイコンから開くと、通知をオンにできます。" : "新しいメッセージが届いたら、スマホの通知でお知らせします。"}</p>
          </div>
          {pushSt === "default" && (
            <button onClick={doEnablePush} disabled={pushBusy} className="f-sans" style={{ flexShrink:0, padding:"9px 14px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{pushBusy ? "..." : "オンにする"}</button>
          )}
          <button onClick={()=>{ setPushDismissed(true); try{localStorage.setItem("cb_pushBannerDismissed","1");}catch{} }} aria-label="閉じる" style={{ flexShrink:0, width:26, height:26, borderRadius:"50%", background:"rgba(0,0,0,0.06)", border:"none", fontSize:12, cursor:"pointer", color:"#5B7B6D" }}>✕</button>
        </div>
      )}
      {/* 運営チャット＝下部フッター上の浮遊ボックス（2026-07-25たきと指示・一覧の最上部行から移設） */}
      <button onClick={()=>{ setDmOpen(true); loadDm(true); }} className={"f-sans cb-admin-chat-fab" + (dmUnread > 0 ? " cb-urgent-card" : "")}
        style={{ position:"fixed", right:12, bottom:"calc(64px + 12px + env(safe-area-inset-bottom, 0px))", zIndex:1200, display:"flex", alignItems:"center", gap:8, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"10px 14px", cursor:"pointer", boxShadow:"0 4px 16px rgba(0,0,0,0.15)" }}>
        <span style={{ fontSize:18, lineHeight:1 }}>🛡</span>
        <span style={{ fontSize:13, fontWeight:700, color:"#222" }}>運営チャット</span>
        {dmUnread > 0 && <span style={{ minWidth:20, height:20, borderRadius:10, background:"#E24B4A", color:"#fff", fontSize:11, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 6px" }}>{dmUnread}</span>}
      </button>
      {/* 運営DMスレッド（ポップアップ0.8秒・✕/背景で閉じる） */}
      {dmOpen && (
        <div onClick={()=>setDmOpen(false)} style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
              <button onClick={()=>setDmOpen(false)} aria-label="閉じる" className="f-sans" style={{ width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:14, cursor:"pointer", flexShrink:0 }}>✕</button>
              <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>🛡 chitose-bank運営</p>
            </div>
            <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:16, display:"flex", flexDirection:"column", gap:10 }}>
              {dmMsgs.length === 0 ? (
                <p className="f-sans" style={{ fontSize:13, color:"#999", textAlign:"center", padding:"32px 0" }}>まだメッセージはありません。運営への連絡もここから送れます。</p>
              ) : dmMsgs.map(m => (
                <div key={m.id} style={{ alignSelf: m.from_admin ? "flex-start" : "flex-end", maxWidth:"85%" }}>
                  {m.from_admin && <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"0 0 2px" }}>🛡 運営</p>}
                  <div className="f-sans" style={{ background: m.from_admin ? "#F5F5F5" : "#00A86B", color: m.from_admin ? "#222" : "#fff", borderRadius:14, padding:"10px 14px", fontSize:14, lineHeight:1.7, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}><LinkifiedText text={m.body} onNavigate={()=>setDmOpen(false)} /></div>
                  <p className="f-sans" style={{ fontSize:10, color:"#C8C8C8", margin:"3px 2px 0", textAlign: m.from_admin ? "left" : "right" }}>{fmtJstShort(m.created_at)}</p>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:8, padding:"10px 12px", borderTop:"1px solid #F0F0F0", flexShrink:0 }}>
              <input value={dmText} onChange={e=>setDmText(e.target.value)} onKeyDown={e=>{ if (e.key === "Enter") sendDm(); }} placeholder="運営へのメッセージ" className="field f-sans" style={{ flex:1, marginBottom:0, fontSize:14 }} />
              <button onClick={sendDm} disabled={dmSending || !dmText.trim()} className="btn-primary f-sans" style={{ padding:"0 18px", fontSize:14, fontWeight:700, opacity: (dmSending || !dmText.trim()) ? 0.5 : 1 }}>送信</button>
            </div>
          </div>
        </div>
      )}
      {loading ? (
        /* 空白や「読み込み中...」でなく、これから出るスレッドと同じ形の箱を並べる（2026-07-27たきと指示） */
        <AutoSkeleton shapeKey="chats" />
      ) : rows.length === 0 ? (
        <div style={{ textAlign:"center", padding:"56px 20px", color:"#999" }} className="f-sans">
          <div style={{ fontSize:40, marginBottom:12 }}>💬</div>
          <p style={{ fontSize:14, margin:0 }}>チャットはまだありません。<br/>応募が承認されると、ここに表示されます。</p>
        </div>
      ) : (
        /* 幅の固定（2026-08-06たきと報告「チャット欄の幅が大きくなった」）：
           列を minmax(0,1fr) にする。既定の auto 列は中身の min-content まで広がるため、
           下の「求人 #… 作物 作業」が whiteSpace:nowrap＝1行で全文ぶんの幅を要求し、
           画面が狭いと列ごとカードが画面より広くなっていた（body の overflow-x:clip で
           右が切れ、段階チップが画面外に消える）。0 を下限にすれば列は器を超えない */
        <div ref={skelRef} style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr)", gap:10 }}>
          {sortedRows.map(a => {
            const title = a.job ? [a.job.crop, a.job.task].filter(Boolean).join(" ") : "";
            const rowUnread = rowUnreadOf(a); // 相手との全応募の未読合算
            return (
              <button key={a.id} onClick={()=>{ window.location.hash = "/chat/" + a.id; }}
                className={"f-sans" + (rowUnread > 0 ? " cb-urgent-card" : "")} style={{ display:"flex", alignItems:"center", gap:12, width:"100%", minWidth:0, textAlign:"left", background:"#fff",
                  border:"1px solid #EBEBEB", borderRadius:12, padding:"14px 16px", cursor:"pointer" }}>
                {/* アイコンタップで相手のプレビュー展開（2026-07-19）：農家側→働き手プレビュー／働き手側→雇い手プレビュー */}
                <span onClick={(e)=>{ e.stopPropagation(); if (a._role === "farmer") openWorkerPreview(a.worker_id); else openEmployerPreview(a.farmer_id); }} style={{ flexShrink:0 }}>
                  <Avatar url={a.partnerAvatar} name={a.partnerName || initialsMap[a._role === "worker" ? a.farmer_id : a.worker_id]} size={40} ring={a._role === "farmer" ? ROLE_ORANGE : ROLE_GREEN} />
                </span>
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:6 }}>
                    {/* 名前が長くても段階チップを押し出さない＝はみ出す側は名前（…で畳む） */}
                    <p style={{ fontSize:14, fontWeight:700, color:"#222", margin:0, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.partnerName || ("求人 #" + a.job_number)}</p>
                    {rowUnread > 0 && <span style={{ minWidth:22, height:22, borderRadius:11, background:"#E24B4A", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 6px", flexShrink:0, marginLeft:"auto" }}>{rowUnread}</span>}
                    {/* 帯統一（2026-07-25たきと指示）：応募者リストと同じ段階色（APP_PHASE_COLOR）のチップ。凡例と同じ地色＋白文字 */}
                    <span onClick={(e)=>{ e.stopPropagation(); openPhaseInfo(appPhaseKey(a)); }} role="button" style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, background: APP_PHASE_COLOR[appPhaseKey(a)] || "#999", color:"#fff", flexShrink:0, cursor:"pointer" }}>{APP_PHASE_LABEL[appPhaseKey(a)] || a.status}</span>
                  </div>
                  <p style={{ fontSize:12, color:"#717171", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>求人 #{a.job_number}{title ? "　" + title : ""}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
