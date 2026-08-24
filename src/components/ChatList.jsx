// 分割3-B（2026-07-25）：App.jsxから移動。チャット一覧＋運営DMポップアップ＋通知オンバナー。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { fetchJobRowListForMe } from "../lib/jobForMe";
import { chatCache, hydrateChatCache, persistChatCache } from "../lib/chatCache";
import { openEmployerPreview, openWorkerPreview, openPhaseInfo } from "../lib/previewBus";
import { AutoSkeleton, useSkeletonProbe } from "./ui";
import { pushStatus, enablePush, isIOS } from "../lib/push";
import { ROLE_ORANGE, ROLE_GREEN, CHAT_LIST_STATUSES, appPhaseKey, APP_PHASE_LABEL, APP_PHASE_COLOR, appPhaseLabelNow, appPhaseColorNow } from "../lib/utils";
import { Avatar } from "./ui";
import { AdminChatRow } from "./AdminChat";
import { NavIcon } from "./NavIcons";

// 隠せる段階（2026-08-18たきと指示）：見送り／失効／取り消しの3つ。応募者ページの APP_HIDABLE と対。
// モジュールレベル定義＝毎描画で作り直さない（effectの依存にも安全に使える）
const CHAT_HIDABLE = ["rejected", "expired", "canceled"];

// 段階チップの「いま」の材料（2026-08-19たきと指示「いま休日。その日の作業thaが終わったら次の日程を表示」）：
// 応募行（合意した日・来られる日）に求人の日程（jobs_public）を重ねて appPhaseLabelNow に渡す。
// 作業日でない日・その日の終了時刻を過ぎた後は「作業中」でなく「次は M/D(曜)」になる。
// ★応募者ページ（FarmerDashboard の appRibbonLabel）と同じ形＝画面ごとに判定が枝分かれしない
const phaseEntry = (a) => ({ ...a, work_time: a.job?.work_time, date_start: a.job?.date_start, date_end: a.job?.date_end, holidays: a.job?.holidays });

// チャット一覧の直近スナップショット（2026-07-22）：チャットから戻った時にスピナーを出さず即表示し、
// 裏で静かに更新する（リロード感の解消）。モジュールレベルなので再マウントをまたいで生き残る
export function ChatList() {
  // 段階表示（2026-08-07たきと指示「はじめは最低限の要素のみ表示。段階的に表示させていく」）：
  // 段階0＝前回の一覧（viewCacheの骨・本文なし）を0往復で即描画
  // 段階1＝応募行が届いたら（1往復目）名前なしの行を出す（名前は「求人 #N」に落ちる）
  // 段階2＝相手名・求人名が届いたら（2往復目）上書き。以降は従来どおり
  const [rows, setRows] = useState(() => hydrateChatCache()?.rows || []);
  const [loading, setLoading] = useState(() => !chatCache.v); // キャッシュがあれば最初からスピナーを出さない
  // 仮配置の骨を測るref（このページが実際に描いた形が、次回の読み込み中の形になる）
  const skelRef = useSkeletonProbe("chats");
  // 運営DM（2026-07-16）は共有部品 AdminChatRow が担う（一覧の最上部の行・タップで #/chat/admin のページへ）
  const [unreadMap, setUnreadMap] = useState(() => chatCache.v?.unreadMap || {}); // { application_id: 未読数 }（my_unread_message_counts・2026-07-17）
  const [initialsMap, setInitialsMap] = useState(() => chatCache.v?.initialsMap || {}); // { partner_auth_id: メール頭文字2文字 }（ニックネーム未設定時のアイコン・2026-07-22）
  // アクション順（2026-07-27たきと指示・同日改定）：並びの既定は「利用者が最後にアクションした順」。
  // アクション＝メッセージの送受信＋応募の記録（応募・承認/見送り・採用・保険報告・完了）。
  // ★チャットを開いただけ（既読＝read_at・chat_reads）は動かさない＝アクションではない（記録の憲法）
  const APP_ACTION_COLS = ["created_at","decided_at","status_changed_at","terms_confirmed_worker_at","terms_confirmed_farmer_at",
    "insurance_prepared_at","work_completed_at"];
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
    else {
      // 理由をそのまま出す（2026-08-17たきと報告）：従来は「時間をおいて」だけで、
      // 何that起きたのか本人にも運営にも分からなかった。iPhoneで多い「Internal error」は
      // 端末側の登録の失敗so、直し方を添える（記録は lib/push that app_errors に残す）
      const iosHint = isIOS()
        ? "\n\niPhoneでの直し方：\n① 設定 → 通知 → chitose-bank で通知を「許可」にする\n② ホーム画面のアイコンを削除し、Safariで開き直して「ホーム画面に追加」からやり直す\n③ それでも直らない時は、この文面をそのまま運営にお知らせください"
        : "";
      alert("通知をオンにできませんでした。\n（原因：" + (r.reason || "不明") + "）" + iosHint);
    }
  };
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
  // リアルタイム（2026-07-19）：チャット一覧を開いている間、新着を購読して一覧の未読数を即時更新。
  // 配信はRLS準拠（自分の当事者チャットのみ）。運営DMの購読は AdminChat が担う（既読化はページ側 #/chat/admin）
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
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "applications" }, onAppUpdate)
      .subscribe();
    // 復帰時の再読込＋保険ポーリング（2026-07-27たきと指示）：iOS PWAのバックグラウンドで
    // WebSocketが凍結・切断されるため、画面復帰で未読を即再取得＋表示中は10秒ごとの保険
    const onWake = () => { if (document.visibilityState === "visible") refreshUnreadMap(); };
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
        // 段階1：応募行だけで行を出す（1往復目）。相手名・求人名は空＝表示は「求人 #N」＋段階チップに落ちる。
        // ★前回の骨（段階0）を表示中なら上書きしない＝名前入りの表示を名前なしに退化させない
        const bare = all.map(a => ({ ...a, partnerName: "", partnerAvatar: "", job: null }))
          .sort((x, y) => new Date(y.created_at) - new Date(x.created_at))
          .map(a => ({ ...a, _appIds: [a.id], _count: 1 }));
        setRows(prev => prev.length ? prev : bare);
        setLoading(false);

        const farmerIds = [...new Set(all.filter(a => a._role === "worker").map(a => a.farmer_id).filter(Boolean))];
        const workerIds = [...new Set(all.filter(a => a._role === "farmer").map(a => a.worker_id).filter(Boolean))];
        const jobNumbers = [...new Set(all.map(a => a.job_number).filter(Boolean))];

        const [epRes, wpRes, jobRes] = await Promise.all([
          farmerIds.length ? supabase.from("employer_profiles_public").select("auth_id,nickname,avatar_url").in("auth_id", farmerIds) : Promise.resolve({ data: [] }),
          workerIds.length ? supabase.rpc("worker_cards_for_farmer", { p_worker_ids: workerIds }) : Promise.resolve({ data: [] }),
          // 日程4列（work_time/date_start/date_end/holidays）は段階チップの「いま」表示用＝
          // 作業日でない日は「作業中」でなく「次は M/D(曜)」を出す（appPhaseLabelNow）
          jobNumbers.length ? fetchJobRowListForMe(jobNumbers, "job_number,crop,task,work_time,date_start,date_end,holidays") : Promise.resolve({ data: [] }),
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
  useEffect(() => {
    if (loading) return;
    chatCache.v = { rows, unreadMap, initialsMap, lastMsgMap };
    persistChatCache(); // 冷間起動の段階0用（本文は含まれない・chatCache.jsの注記参照）
  }, [rows, unreadMap, initialsMap, lastMsgMap, loading]);

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
  // 並びはLINE式（2026-08-08たきと指示「あちらからの返信もチャットの上位に。LINEはどうしている？
  // 解析して反映」）＝【最後のメッセージ／アクションの新しい順だけ】。送った・届いたのどちらでも動く。
  // 未読は並びを変えない＝赤バッジと跳ね（cb-urgent-card）で示すだけ（LINEと同じ）。
  // 旧「未読を先頭に固める」（2026-07-27）は廃止：既読済みの返信が古い未読の下に沈む
  // ＝「相手の返信が上に来ない」の原因だった。rowLastAt＝メッセージ（双方向）と応募の記録の最新時刻
  const sortedRows = [...rows].sort((x, y) => rowLastAt(y) - rowLastAt(x));

  // 非表示の選択（2026-08-18たきと指示。同日改定「すべて削除で、取り消しに差し替え」）：
  // ピルは【隠すもの】3つだけ＝見送り／失効／取り消し。選ぶとその段階のチャットが一覧から消える。
  // 3つとも同時に選べる（複数選択）。「すべて」ピルは廃止＝全部表示したい時は選択を1つずつ外す
  //   （空状態からは「すべて表示する」で一度に戻せる）。
  // 既定は3つとも選んだ状態＝終わった取引（見送り・失効・取り消し）that日常の一覧を埋めない。
  // 隠すのは表示だけ＝記録・並び・未読・データ取得は不変（行動記録の憲法：記録は消さない）
  const [chatHidden, setChatHidden] = useState(() => {
    // 保存キーは_v2＝取り消しを足した既定thatすぐ効く（旧cb_chatHiddenの値は引き継がない）
    try {
      const raw = sessionStorage.getItem("cb_chatHidden_v2");
      if (raw !== null) { const v = JSON.parse(raw); if (Array.isArray(v)) return v.filter(k => CHAT_HIDABLE.includes(k)); }
    } catch {}
    return [...CHAT_HIDABLE]; // 既定＝3つとも非表示
  });
  useEffect(() => { try { sessionStorage.setItem("cb_chatHidden_v2", JSON.stringify(chatHidden)); } catch {} }, [chatHidden]);
  const shownRows = sortedRows.filter(a => !chatHidden.includes(appPhaseKey(a)));
  const filterButtons = CHAT_HIDABLE.map(k => ({
    k, label: APP_PHASE_LABEL[k], on: chatHidden.includes(k),
    onTap: () => setChatHidden(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]),
  })).map(b => (
    <button key={b.k} onClick={b.onTap} aria-pressed={b.on} className="f-sans" style={{ flex:"1 0 auto", display:"flex", alignItems:"center", gap:6, padding:"8px 14px", borderRadius:20, border: b.on ? "2px solid #222" : "1px solid #EBEBEB", background:"#fff", fontSize:13, fontWeight: b.on?800:600, color: b.on?"#222":"#999", cursor:"pointer", whiteSpace:"nowrap" }}>
      {/* 段階色の点＝帯・チップと同じAPP_PHASE_COLOR */}
      <span aria-hidden="true" style={{ width:8, height:8, borderRadius:"50%", background: APP_PHASE_COLOR[b.k] || "#999", flexShrink:0 }} />
      {/* 選択中＝隠している、を目で分かるように取り消し線 */}
      <span style={{ textDecoration: b.on ? "line-through" : "none" }}>{b.label}</span>
    </button>
  ));

  return (
    <div style={{ maxWidth:600, margin:"0 auto", padding:"5px 0 8px" }}>{/* 上余白はmainの10px＋ここ5px＝15px固定（2026-07-25たきと指示） */}
      {/* 見出し「チャット」は削除（2026-07-27たきと指示）：下部ナビで現在地が分かる＝重複。
          上の空白は15px固定のまま（main 10px＋この箱 5px） */}
      {/* 通知をオンにする案内（2026-07-19）：未許可かつ対応環境のみ。granted/denied/未対応では出さない */}
      {!pushDismissed && (pushSt === "default" || pushSt === "need-standalone") && (
        <div className="f-sans" style={{ display:"flex", alignItems:"center", gap:12, background:"#F0F7F4", border:"1px solid #CDE9DD", borderRadius:12, padding:"12px 14px", marginBottom:10 }}>
          <span style={{ flexShrink:0, display:"flex", color:"#0B6B4F" }}><NavIcon name="bell" size={22} /></span>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontSize:13, fontWeight:700, color:"#222", margin:0 }}>メッセージの通知を受け取る</p>
            <p style={{ fontSize:12, color:"#5B7B6D", margin:"2px 0 0", lineHeight:1.6 }}>{pushSt === "need-standalone" ? "「ホーム画面に追加」したアイコンから開くと、通知をオンにできます。" : "新しいメッセージが届いたら、スマホの通知でお知らせします。"}</p>
          </div>
          {pushSt === "default" && (
            <button onClick={doEnablePush} disabled={pushBusy} className="f-sans" style={{ flexShrink:0, padding:"9px 14px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{pushBusy ? "..." : "オンにする"}</button>
          )}
          <button onClick={()=>{ setPushDismissed(true); try{localStorage.setItem("cb_pushBannerDismissed","1");}catch{} }} aria-label="閉じる" style={{ flexShrink:0, width:26, height:26, borderRadius:"50%", background:"rgba(0,0,0,0.06)", border:"none", cursor:"pointer", color:"#5B7B6D", display:"flex", alignItems:"center", justifyContent:"center" }}><NavIcon name="close" size={12} /></button>
        </div>
      )}
      {/* ステータス絞り込みバー（2026-08-07たきと指示）：応募者ページと同じCSSクラスを共用＝
          モバイルは下部の浮遊バー・PCは本文中の並び。格納・入力中退避・チャット表示中の非表示も同じ作法 */}
      <div className="cb-applicant-filter-inline" style={{ display:"flex", gap:6, marginBottom:10, overflowX:"auto", WebkitOverflowScrolling:"touch" }}>{filterButtons}</div>
      <div className="cb-applicant-filter-bar">{filterButtons}</div>
      {/* 運営チャット＝一覧の最上部の行（2026-08-19たきと指示「浮遊ボックスは撤回。チャット一覧に移植」）。
          読み込み中・チャット0件でも出す＝運営への連絡口はいつでもここにある */}
      <AdminChatRow />
      {loading ? (
        /* 空白や「読み込み中...」でなく、これから出るスレッドと同じ形の箱を並べる（2026-07-27たきと指示） */
        <AutoSkeleton shapeKey="chats" />
      ) : rows.length === 0 ? (
        <div style={{ textAlign:"center", padding:"56px 20px", color:"#999" }} className="f-sans">
          <div style={{ marginBottom:12, display:"flex", justifyContent:"center", color:"#B0B0B0" }}><NavIcon name="chats" size={40} /></div>
          <p style={{ fontSize:14, margin:0 }}>チャットはまだありません。<br/>応募が承認されると、ここに表示されます。</p>
        </div>
      ) : shownRows.length === 0 ? (
        /* 非表示で0件（チャット自体はある）＝理由と戻し方を明記（空ボックスに説明の原則・2026-08-03） */
        <div style={{ textAlign:"center", padding:"48px 20px", color:"#999" }} className="f-sans">
          <p style={{ fontSize:14, margin:0 }}>
            表示できるチャットはありません。<br/>
            {chatHidden.map(k => APP_PHASE_LABEL[k]).join("・")}を非表示にしています。
          </p>
          <button onClick={()=>setChatHidden([])} className="f-sans" style={{ marginTop:14, padding:"9px 16px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>すべて表示する</button>
        </div>
      ) : (
        /* 幅の固定（2026-08-06たきと報告「チャット欄の幅が大きくなった」）：
           列を minmax(0,1fr) にする。既定の auto 列は中身の min-content まで広がるため、
           下の「求人 #… 作物 作業」が whiteSpace:nowrap＝1行で全文ぶんの幅を要求し、
           画面が狭いと列ごとカードが画面より広くなっていた（body の overflow-x:clip で
           右が切れ、段階チップが画面外に消える）。0 を下限にすれば列は器を超えない */
        <div ref={skelRef} style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr)", gap:10 }}>
          {shownRows.map(a => {
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
                    <span onClick={(e)=>{ e.stopPropagation(); openPhaseInfo(appPhaseKey(a)); }} role="button" style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, background: appPhaseColorNow(a, phaseEntry(a)) || "#999", color:"#fff", flexShrink:0, cursor:"pointer" }}>{appPhaseLabelNow(a, phaseEntry(a)) || a.status}</span>
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
