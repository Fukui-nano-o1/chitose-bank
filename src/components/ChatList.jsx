// 分割3-B（2026-07-25）：App.jsxから移動。チャット一覧＋運営DMポップアップ＋通知オンバナー。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { fetchJobRowListForMe } from "../lib/jobForMe";
import { chatCache, hydrateChatCache, persistChatCache } from "../lib/chatCache";
import { useRefreshTick, REFRESH_APPLICATIONS } from "../lib/refreshBus";
import { openSupport } from "../lib/supportDiagnostics";
import { CHAT_CLOSED, chatInboxTime, mergeChatPreviews, chatDeadline } from "../lib/chatMessaging";
import "./Chat.css";
import { AutoSkeleton, useSkeletonProbe } from "./ui";
import { pushStatus, enablePush, isIOS } from "../lib/push";
import { ROLE_ORANGE, ROLE_GREEN, CHAT_LIST_STATUSES, appPhaseKey, APP_PHASE_LABEL, APP_PHASE_COLOR, appPhaseLabelNow, appPhaseColorNow } from "../lib/utils";
import { Avatar, CHAT_ROW_GAP, CHAT_ROW_PAD, CHAT_ROW_DIVIDER } from "./ui";
import { AdminChatRow, AdminDmInboxRows } from "./AdminChat";
import { NavIcon } from "./NavIcons";

// 隠せる段階（2026-08-18たきと指示）：見送り／失効／取り消しの3つ。応募者ページの APP_HIDABLE と対。
// モジュールレベル定義＝毎描画で作り直さない（effectの依存にも安全に使える）

// 読み込み中に届いた新着を、遅れて返った履歴や順序が前後した配信で巻き戻さない。
const mergeMessageTimes = (previous, messages) => {
  const next = { ...previous };
  for (const m of messages) {
    if (!m.application_id || !m.created_at) continue;
    if (!next[m.application_id] || new Date(m.created_at) > new Date(next[m.application_id])) {
      next[m.application_id] = m.created_at;
    }
  }
  return next;
};

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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [previews, setPreviews] = useState({}); // 本文の要約はメモリのみ。永続キャッシュへ入れない
  const [loading, setLoading] = useState(() => !chatCache.v); // キャッシュがあれば最初からスピナーを出さない
  const refreshTick = useRefreshTick(REFRESH_APPLICATIONS);
  const pendingAppUpdates = useRef(null);
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
    let cancelled = false;
    // 未読数と独立して開始する。新しい相手も、応募の再取得に合わせて補う。
    Promise.resolve(supabase.rpc("my_chat_partner_initials")).then(({ data, error }) => {
      if (!cancelled && !error && data) setInitialsMap(data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [refreshTick]);
  // リアルタイム（2026-07-19）：チャット一覧を開いている間、新着を購読して一覧の未読数を即時更新。
  // 配信はRLS準拠（自分の当事者チャットのみ）。運営DMの購読は AdminChat が担う（既読化はページ側 #/chat/admin）
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let refreshAgain = false;
    const refreshUnreadMap = async () => {
      if (cancelled) return;
      // 新着・復帰・ポーリングの同時発火をまとめる。取得中に新着があれば最後に取り直す。
      if (inFlight) { refreshAgain = true; return; }
      inFlight = true;
      try {
        const [unread, latest] = await chatDeadline(Promise.all([
          supabase.rpc("my_unread_message_counts"), supabase.rpc("my_chat_inbox_previews"),
        ]));
        if (!cancelled && !unread.error && unread.data) setUnreadMap(unread.data.by_application || {});
        if (!cancelled && !latest.error && latest.data) {
          setLastMsgMap(previous => mergeMessageTimes(previous, latest.data));
          setPreviews(previous => mergeChatPreviews(previous, latest.data));
        }
      } catch {} finally {
        inFlight = false;
        if (refreshAgain && !cancelled) { refreshAgain = false; refreshUnreadMap(); }
      }
    };
    // 新着メッセージのINSERTでは、その応募の最終メッセージ時刻も更新する＝返信順が即座に入れ替わる（2026-07-27）
    const onNewMsg = (payload) => {
      refreshUnreadMap();
      const m = payload?.new;
      if (!cancelled && m?.application_id && m?.created_at) {
        setLastMsgMap(prev => mergeMessageTimes(prev, [m]));
        setPreviews(prev => mergeChatPreviews(prev, [m]));
      }
    };
    // 応募のアクション（承認・採用・保険報告・開始・完了・終了確認）で並びが動くよう、
    // applicationsのUPDATEも購読して手元の行を差し替える（2026-07-27・アクション順）
    const onAppUpdate = (payload) => {
      const a = payload?.new; if (!a?.id) return;
      if (cancelled) return;
      pendingAppUpdates.current?.set(a.id, a);
      setRows(prev => (prev || []).map(x => x.id === a.id ? { ...x, ...a } : x));
    };
    const ch = supabase.channel("chatlist-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, onNewMsg)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "applications" }, onAppUpdate)
      .subscribe();
    refreshUnreadMap();
    // 復帰時の再読込＋保険ポーリング（2026-07-27たきと指示）：iOS PWAのバックグラウンドで
    // WebSocketが凍結・切断されるため、画面復帰で未読を即再取得＋表示中は10秒ごとの保険
    const onWake = () => { if (document.visibilityState === "visible") { refreshUnreadMap(); setRetry(value => value + 1); } };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    const iv = setInterval(() => { if (document.visibilityState === "visible") refreshUnreadMap(); }, 10000);
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      clearInterval(iv);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const liveUpdates = new Map();
    pendingAppUpdates.current = liveUpdates;
    (async () => {
      try {
        const { data: { session } } = await chatDeadline(supabase.auth.getSession());
        if (cancelled) return;
        if (!session) throw new Error("session");
        const uid = session.user.id;
        const [workerRes, farmerRes] = await chatDeadline(Promise.all([
          supabase.from("applications").select("*").eq("worker_id", uid).in("status", CHAT_LIST_STATUSES),
          supabase.from("applications").select("*").eq("farmer_id", uid).in("status", CHAT_LIST_STATUSES),
        ]));
        // 片側だけ失敗した場合も、既存の一覧を空／半分の結果で置き換えない。
        if (cancelled) return;
        if (workerRes.error || farmerRes.error) throw workerRes.error || farmerRes.error;
        setLoadError("");
        // worker_id===farmer_id（自分の求人に自分で応募したテストデータ等）で同一行が
        // 両方のクエリに一致するケースがあるため、id基準で重複排除する
        const byId = new Map();
        [...(workerRes.data || []).map(a => ({ ...a, _role: "worker" })),
         ...(farmerRes.data || []).map(a => ({ ...a, _role: "farmer" }))]
          .forEach(a => { if (!byId.has(a.id)) byId.set(a.id, a); });
        // 取得開始後のRealtime更新を優先する。付加情報の到着でも状態を巻き戻さない。
        for (const [id, update] of liveUpdates) {
          if (update.worker_id === uid || update.farmer_id === uid) {
            byId.set(id, { ...byId.get(id), ...update, _role: update.worker_id === uid ? "worker" : "farmer" });
          }
        }
        if (pendingAppUpdates.current === liveUpdates) pendingAppUpdates.current = null;
        const all = [...byId.values()].filter(a => CHAT_LIST_STATUSES.includes(a.status));
        if (all.length === 0) { setRows([]); setLoading(false); return; }
        // 状態と新しい行は先に反映。既存行の相手名・求人は届くまで保ち、空欄に戻さない。
        setRows(prev => {
          const cached = new Map(prev.map(a => [a.id, a]));
          return all.map(a => {
            const old = cached.get(a.id);
            const samePartner = old?._role === a._role && old?.worker_id === a.worker_id && old?.farmer_id === a.farmer_id;
            return { ...a, partnerName: samePartner ? old.partnerName : "", partnerAvatar: samePartner ? old.partnerAvatar : "",
              job: old?.job_number === a.job_number ? old.job : null, _appIds: [a.id], _count: 1 };
          });
        });
        setLoading(false);

        const farmerIds = [...new Set(all.filter(a => a._role === "worker").map(a => a.farmer_id).filter(Boolean))];
        const workerIds = [...new Set(all.filter(a => a._role === "farmer").map(a => a.worker_id).filter(Boolean))];
        const jobNumbers = [...new Set(all.map(a => a.job_number).filter(Boolean))];

        // 相手名・求人・返信順は互いに待たず、到着した部分だけ既存行へ重ねる。
        const addPartners = (request, role, key) => Promise.resolve(request).then(({ data, error }) => {
          if (cancelled || error || !data) return;
          const partners = new Map(data.map(p => [p.auth_id, p]));
          setRows(prev => prev.map(a => {
            if (a._role !== role) return a;
            const partner = partners.get(a[key]);
            return { ...a, partnerName: partner?.nickname || "", partnerAvatar: partner?.avatar_url || "" };
          }));
        }).catch(() => {});
        if (farmerIds.length) addPartners(supabase.from("employer_profiles_public").select("auth_id,nickname,avatar_url").in("auth_id", farmerIds), "worker", "farmer_id");
        if (workerIds.length) addPartners(supabase.rpc("worker_cards_for_farmer", { p_worker_ids: workerIds }), "farmer", "worker_id");
        if (jobNumbers.length) Promise.resolve(fetchJobRowListForMe(jobNumbers, "job_number,crop,task,work_time,date_start,date_end,holidays"))
          .then(({ data, error }) => {
            if (cancelled || error || !data) return;
            const jobs = new Map(data.map(j => [j.job_number, j]));
            setRows(prev => prev.map(a => ({ ...a, job: jobs.get(a.job_number) || null })));
          }).catch(() => {});
      } catch { if (!cancelled) setLoadError("会話を読み込めませんでした。通信状況を確認して、もう一度お試しください。"); } finally {
        if (!cancelled) setLoading(false);
        if (pendingAppUpdates.current === liveUpdates) pendingAppUpdates.current = null;
      }
    })();
    return () => {
      cancelled = true;
      if (pendingAppUpdates.current === liveUpdates) pendingAppUpdates.current = null;
    };
  }, [refreshTick, retry]);

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

  const shownRows = sortedRows.filter(a => {
    if (filter === "support") return false;
    if (filter === "unread" && !rowUnreadOf(a)) return false;
    if (filter === "active" && CHAT_CLOSED.includes(a.status)) return false;
    if (filter === "past" && !CHAT_CLOSED.includes(a.status)) return false;
    const words = query.trim().toLocaleLowerCase().split(/\s+/).map(word => word.replace(/^#/, "")).filter(Boolean);
    const haystack = [a.partnerName, a.job_number, a.job?.crop, a.job?.task].join(" ").toLocaleLowerCase();
    return words.every(word => haystack.includes(word));
  });
  return (
    <section className="chat-inbox f-sans" aria-label="メッセージ一覧">
      <div className="chat-inbox-heading"><h1>メッセージ</h1><button className="chat-text-button" onClick={() => openSupport({ topic: "chat", view: "compose" })}>この画面を報告</button></div>
      <label className="chat-search"><NavIcon name="search" size={20} /><input aria-label="相手の名前・仕事・求人番号で検索" type="search" placeholder="名前・仕事・求人番号で検索" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="chat-filters" aria-label="会話の絞り込み">{[["all","すべて"],["unread","未読"],["active","進行中"],["past","終了"],["support","運営"]].map(([key,label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
      {loadError && <div className="chat-notice" role="alert">{loadError}<br/><button className="chat-text-button" onClick={() => setRetry(value => value + 1)}>再読み込み</button><button className="chat-text-button" onClick={() => openSupport({ topic: "chat" })}>ヘルプ</button></div>}
      {/* 通知をオンにする案内（2026-07-19）：未許可かつ対応環境のみ。granted/denied/未対応では出さない */}
      {!pushDismissed && (pushSt === "default" || pushSt === "need-standalone") && (
        <div className="f-sans" style={{ display:"flex", alignItems:"center", gap:12, background:"#F0F7F4", border:"1px solid #CDE9DD", borderRadius:12, padding:"12px 14px", marginBottom:CHAT_ROW_GAP }}>
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
      {["all","unread","support"].includes(filter) ? <><AdminChatRow query={query} unreadOnly={filter === "unread"} /><AdminDmInboxRows query={query} unreadOnly={filter === "unread"} /></> : null}
      {filter === "support" && <p className="chat-inbox-note">運営への相談・返信はこちらから確認できます。</p>}
      {filter === "support" ? null : loading ? <AutoSkeleton shapeKey="chats" /> : shownRows.length === 0 ? (
        <div className="chat-empty">
          <NavIcon name="chats" size={36}/><h2>{rows.length ? "該当する仕事の会話はありません" : loadError ? "会話を取得できません" : "会話はここから始まります"}</h2>
          <p>{rows.length ? "検索する言葉や絞り込みを変えてみてください。" : loadError ? "上の再読み込みから、もう一度お試しください。" : "応募が承認されると、仕事ごとに相手と連絡できます。"}</p>
          {rows.length ? <button className="chat-text-button" onClick={() => { setQuery(""); setFilter("all"); }}>すべての会話を表示</button> : !loadError && <a className="chat-text-button" href="#/search">仕事を探す</a>}
        </div>
      ) : <div ref={skelRef}>{shownRows.map(a => {
        const unread = rowUnreadOf(a), preview = previews[a.id];
        const title = [a.job?.crop, a.job?.task].filter(Boolean).join(" ") || "仕事の連絡";
        return <button key={a.id} data-guide="chat-row" className={`chat-inbox-row${unread ? " is-unread" : ""}`} onClick={() => { window.location.hash = "/chat/" + a.id; }}>
          <Avatar url={a.partnerAvatar} name={a.partnerName || initialsMap[a._role === "worker" ? a.farmer_id : a.worker_id]} size={56} />
          <div className="chat-row-content">
            <div className="chat-row-title"><strong>{a.partnerName || "相手の名前を確認中"}</strong><time>{chatInboxTime(rowLastAt(a))}</time>{unread > 0 && <span className="chat-unread" aria-label={`未読${unread}件`} />}</div>
            <p className="chat-row-preview">{preview ? String(preview.body || "").replace(/\s+/g," ") : "会話を開いてメッセージを確認"}</p>
            <p>{title} · #{a.job_number}</p>
            <p><span className={`chat-stage${CHAT_CLOSED.includes(a.status) ? " is-closed" : ""}`}>{appPhaseLabelNow(a, phaseEntry(a)) || a.status}</span>{a.job?.date_start ? ` · ${chatInboxTime(a.job.date_start)}${a.job?.work_time ? ` ${a.job.work_time}` : ""}` : ""}</p>
          </div>
        </button>;
      })}</div>}
    </section>
  );
}
