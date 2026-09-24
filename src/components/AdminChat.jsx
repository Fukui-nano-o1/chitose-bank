// 運営チャット（運営DM）＝一覧の行（AdminChatRow）と、そのスレッドのページ（AdminChatPage）。
// 2026-08-24たきと指示「運営だけボックス展開はおかしい。ページ遷移だ。運営チャットは新しいリンクを」＝
// ポップアップ（2026-07-16〜）をやめ、当事者チャットと同じ【ページ】にした。リンクは #/chat/admin
// （★App.jsx の chatAppId は /^chat\/(admin(\/uuid)?|uuid)$/ で拾う。"admin" は uuid の文字集合 [0-9a-f-] に
//  当たらないので当事者チャットとは衝突しない。この1つの器に相乗りしたので、既存の !chatAppId ガード
//  ・トーストの抑止・readHashTab が全部そのまま効く＝新しい判定を増やしていない）。
// 中身（admin_messages・本人スレのみRLS・リアルタイム・復帰時再取得・既読化）は従来のまま。
//
// 2026-09-04たきと報告「利用者が運営にチャットから連絡してもこちらに送信されない」＝
// 送信はDBに入っていたが、運営側に受け取る場所が無かった（読めるのは管理タブ→利用者一覧→DMだけ・
// 通知もバッジもゼロ）。運営側の受け取りを新設：
//  ・AdminDmInboxRows＝運営のチャット一覧に利用者からのDMスレッドを並べる（未読バッジつき）
//  ・AdminChatPage に targetUserId＝運営がその利用者のスレッドを開いて返信するページ（#/chat/admin/{uid}）
//  ・DB側はお知らせ＋メール＋dmバッジ（migration 20260904132932）
import { useState, useEffect, useRef } from "react";
import { closeReadNotifications } from "../lib/push";
import { supabase } from "../lib/supabase";
import { fmtJstShort, isAdmin } from "../lib/utils";
import { useSwipeBack } from "../lib/swipeBack";
import { LinkifiedText, Dots, Avatar, CHAT_ROW_GAP, CHAT_ROW_PAD, CHAT_ROW_DIVIDER } from "./ui";
import { NavIcon, NavIconInline } from "./NavIcons";
import { useChatViewport } from "../lib/useChatViewport";
import { chatDeadline, sendChatMessage, chatDay, chatTime } from "../lib/chatMessaging";
import { readChatDraft, saveChatDraft } from "../lib/chatDrafts";
import { openSupport } from "../lib/supportDiagnostics";
import "./Chat.css";


export const ADMIN_CHAT_HASH = "/chat/admin";

// 運営DMの読み書きの唯一の窓口（行とページで共有＝取得の形を2つ持たない）。
// targetUserId あり＝運営がその利用者のスレッドを読む（RLS「am select」が運営に全スレッドを開いている）
async function fetchDm(targetUserId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const threadUid = targetUserId || session.user.id;
  const { data, error } = await supabase.from("admin_messages").select("*").eq("user_id", threadUid).order("created_at", { ascending: true });
  if (error) return null; // 失敗時は手元の値を上書きしない（2026-08-07のフェイルオープン規則）
  return { uid: session.user.id, user: session.user, msgs: data || [] };
}

export function AdminChatRow({ query = "", unreadOnly = false }) {
  const [msgs, setMsgs] = useState([]);
  const load = async () => { const r = await fetchDm(); if (r) setMsgs(r.msgs); };
  useEffect(() => {
    load();
    // リアルタイム（2026-07-19）＋復帰時の再取得（2026-07-27・iOS PWAのWebSocket凍結対策）
    const ch = supabase.channel("admin-dm-row")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_messages" }, () => load())
      .subscribe();
    const onWake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, []);
  const unread = msgs.filter(m => m.from_admin && !m.read_at).length;
  // 一覧に出す1行ぶんの下書き（プレビュー＝最後のメッセージ。無ければ使い方の一言）
  const last = msgs.length ? msgs[msgs.length - 1] : null;
  const preview = last ? (last.from_admin ? "運営：" : "") + String(last.body || "").replace(/\s+/g, " ") : "運営への連絡もここから送れます。";
  if ((unreadOnly && !unread) || !query.trim().toLowerCase().split(/\s+/).every(word => "chitose-bank運営".includes(word))) return null;
  return (
    // 一覧の最上部の行（他のスレッド行と同じ形：アイコン40px・名前・未読バッジ・下に1行の要約）。
    // 他の行と同じくページへ遷移する（ここで開かない）
    <button data-guide="admin-chat-row" onClick={()=>{ window.location.hash = ADMIN_CHAT_HASH; }}
      className={"f-sans" + (unread > 0 ? " cb-urgent-card" : "")}
      style={{ display:"flex", alignItems:"center", gap:12, width:"100%", minWidth:0, textAlign:"left", background:"#fff",
        border:"1px solid #EBEBEB", borderRadius:12, padding:CHAT_ROW_PAD, cursor:"pointer", marginBottom:CHAT_ROW_GAP }}>
      <span style={{ flexShrink:0, width:40, height:40, borderRadius:"50%", background:"#F0F7F3", border:"1px solid #DDEDE5", display:"flex", alignItems:"center", justifyContent:"center", color:"#00A86B" }}><NavIcon name="support" size={20} /></span>
      <div style={{ minWidth:0, flex:1 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:2 }}>
          <p style={{ fontSize:14, fontWeight:700, color:"#222", margin:0, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>chitose-bank運営</p>
          {unread > 0 && <span style={{ minWidth:22, height:22, borderRadius:11, background:"#E24B4A", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 6px", flexShrink:0, marginLeft:"auto" }}>{unread}</span>}
          {/* 段階チップの位置には役割を出す（当事者チャットと見分けがつくように） */}
          <span style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, background:"#5B7B6D", color:"#fff", flexShrink:0 }}>運営</span>
        </div>
        <p style={{ fontSize:12, color:"#717171", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{preview}</p>
      </div>
    </button>
  );
}

// 運営専用：利用者からのDMスレッドの一覧の行（2026-09-04）。
// チャット一覧の運営行の直下に並ぶ。運営以外・スレッド0件なら何も描かない。
// 読むのは admin_messages（RLS「am select」＝運営は全スレッド可）と、名前・アイコンの
// worker_profiles / employer_profiles（どちらも管理者RLSで読める）。書き込みはここには無い。
export function AdminDmInboxRows({ query = "", unreadOnly = false }) {
  const [threads, setThreads] = useState([]);
  const load = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !isAdmin(session.user)) return;
      const { data, error } = await supabase.from("admin_messages")
        .select("id,user_id,from_admin,body,read_at,created_at").order("created_at", { ascending: true });
      if (error || !data) return; // 失敗時は手元の値を上書きしない
      const map = new Map();
      data.forEach(m => {
        if (m.user_id === session.user.id) return; // 自分のスレッド（エラーレポート等）は上の運営行が担う
        const t = map.get(m.user_id) || { uid: m.user_id, last: null, unread: 0, profile: null };
        t.last = m;
        if (!m.from_admin && !m.read_at) t.unread += 1;
        map.set(m.user_id, t);
      });
      const list = [...map.values()].sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at));
      const ids = list.map(t => t.uid);
      if (ids.length) {
        try {
          const [w, e] = await Promise.all([
            supabase.from("worker_profiles").select("auth_id,nickname,avatar_url").in("auth_id", ids),
            supabase.from("employer_profiles").select("auth_id,nickname,avatar_url").in("auth_id", ids),
          ]);
          const nm = {};
          (e.data || []).forEach(p => { nm[p.auth_id] = { nickname: p.nickname, avatar_url: p.avatar_url }; });
          (w.data || []).forEach(p => { const cur = nm[p.auth_id] || {}; nm[p.auth_id] = { nickname: p.nickname || cur.nickname, avatar_url: p.avatar_url || cur.avatar_url }; });
          list.forEach(t => { t.profile = nm[t.uid] || null; });
        } catch { /* 名前が引けなくても行は出す（「利用者」に落ちる） */ }
      }
      setThreads(list);
    } catch {}
  };
  useEffect(() => {
    load();
    const ch = supabase.channel("admin-dm-inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_messages" }, () => load())
      .subscribe();
    const onWake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("cb:unreadRefresh", load);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("cb:unreadRefresh", load);
    };
  }, []);
  const visible = threads.filter(thread => (!unreadOnly || thread.unread) && query.trim().toLowerCase().split(/\s+/).every(word => (thread.profile?.nickname || "利用者").toLowerCase().includes(word)));
  if (!visible.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {visible.map((t, i) => (
        <button key={t.uid} onClick={()=>{ window.location.hash = ADMIN_CHAT_HASH + "/" + t.uid; }}
          className={"f-sans" + (t.unread > 0 ? " cb-urgent-card" : "")}
          style={{ display:"flex", alignItems:"center", gap:12, width:"100%", minWidth:0, textAlign:"left", background:"#fff",
            border:"none", borderBottom: i < threads.length - 1 ? CHAT_ROW_DIVIDER : "none", borderRadius:0, padding:CHAT_ROW_PAD, cursor:"pointer", marginBottom:CHAT_ROW_GAP }}>
          <span style={{ flexShrink:0 }}><Avatar url={t.profile?.avatar_url} name={t.profile?.nickname || "？"} size={40} /></span>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:2 }}>
              <p style={{ fontSize:14, fontWeight:700, color:"#222", margin:0, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.profile?.nickname || "利用者"}</p>
              {t.unread > 0 && <span style={{ minWidth:22, height:22, borderRadius:11, background:"#E24B4A", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 6px", flexShrink:0, marginLeft:"auto" }}>{t.unread}</span>}
              <span style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, background:"#fff", color:"#5B7B6D", border:"1px solid #5B7B6D", flexShrink:0 }}>運営宛</span>
            </div>
            <p style={{ fontSize:12, color:"#717171", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{(t.last.from_admin ? "運営：" : "") + String(t.last.body || "").replace(/\s+/g, " ")}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

// 運営DMのスレッドページ（#/chat/admin）。器は当事者チャットと同じ .chat-full
// ＝下部バー・ヘッダー・フッターが隠れ、ページ自体はスクロールせず中のメッセージ欄だけが動く。
// targetUserId あり（#/chat/admin/{uid}・運営専用）＝その利用者のスレッドを開いて運営として返信する
export function AdminChatPage({ onBack, targetUserId }) {
  const [msgs, setMsgs] = useState([]), [loading, setLoading] = useState(true), [denied, setDenied] = useState(false);
  const [partnerName, setPartnerName] = useState(null), [text, setText] = useState("");
  const [sending, setSending] = useState(false), [error, setError] = useState(""), [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(null);
  const uidRef = useRef(null), scrollRef = useRef(null), pageRef = useRef(null), alive = useRef(true), loadingRef = useRef(false), busyRef = useRef(false), pendingRef = useRef(null), nearBottom = useRef(true);
  const thread = "admin:" + (targetUserId || "self");
  useSwipeBack(pageRef, onBack);
  useChatViewport(pageRef);
  const isMine = message => targetUserId ? message.from_admin : !message.from_admin;
  const change = value => { setText(value); saveChatDraft(uidRef.current, thread, { text: value, pending: pendingRef.current }); };
  const load = async () => {
    if (loadingRef.current || !alive.current) return;
    loadingRef.current = true;
    try {
      const result = await chatDeadline(fetchDm(targetUserId));
      if (!alive.current) return;
      if (!result) throw new Error("load");
      if (targetUserId && !isAdmin(result.user)) { setDenied(true); return; }
      if (!uidRef.current) {
        const draft = readChatDraft(result.uid, thread);
        setText(draft.text); setPending(draft.pending); pendingRef.current = draft.pending;
      }
      uidRef.current = result.uid; setLoadError("");
      setMsgs(previous => result.msgs.length || !previous.length ? result.msgs : previous);
      if (pendingRef.current && result.msgs.some(message => message.id === pendingRef.current.id)) {
        pendingRef.current = null; setPending(null); setText(""); setError("");
        saveChatDraft(result.uid, thread, { text: "", pending: null });
      }
      const unread = result.msgs.filter(message => !isMine(message) && !message.read_at);
      if (document.visibilityState === "visible" && nearBottom.current && unread.length) {
        const marked = await supabase.from("admin_messages").update({ read_at: new Date().toISOString() }).in("id", unread.map(message => message.id));
        if (!marked.error && alive.current) { window.dispatchEvent(new Event("cb:unreadRefresh")); if (!targetUserId) closeReadNotifications(["cb-dm"]); }
      }
    } catch { if (alive.current) setLoadError("メッセージを読み込めませんでした。もう一度お試しください。"); }
    finally { loadingRef.current = false; if (alive.current) setLoading(false); }
  };
  useEffect(() => {
    alive.current = true; load();
    if (targetUserId) Promise.all([
      supabase.from("worker_profiles").select("nickname").eq("auth_id", targetUserId).maybeSingle(),
      supabase.from("employer_profiles").select("nickname").eq("auth_id", targetUserId).maybeSingle(),
    ]).then(([worker, employer]) => { if (alive.current) setPartnerName(worker.data?.nickname || employer.data?.nickname || null); }).catch(() => {});
    const channel = supabase.channel("admin-dm-page:" + thread).on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_messages" }, () => load()).subscribe();
    const wake = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", wake); document.addEventListener("visibilitychange", wake);
    const timer = setInterval(wake, 10000);
    return () => { alive.current = false; supabase.removeChannel(channel); clearInterval(timer); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); };
    // The route keys this component by account and thread, so async results cannot cross conversations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (nearBottom.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs.length]);
  const send = async () => {
    const uid = uidRef.current, body = text.trim();
    if (!body || busyRef.current || !uid || denied) return;
    const row = pendingRef.current || { id: crypto.randomUUID(), user_id: targetUserId || uid, from_admin: !!targetUserId, body };
    pendingRef.current = row; setPending(row); saveChatDraft(uid, thread, { text: body, pending: row });
    busyRef.current = true; setSending(true); setError("");
    try {
      const message = await sendChatMessage(supabase, "admin_messages", row);
      saveChatDraft(uid, thread, { text: "", pending: null });
      if (!alive.current) return;
      pendingRef.current = null; setPending(null); setText(""); nearBottom.current = true;
      setMsgs(previous => previous.some(item => item.id === message.id) ? previous : [...previous, message]);
    } catch { if (alive.current) setError("送信を確認できませんでした。入力は残っています。同じ内容で再送できます。"); }
    finally { busyRef.current = false; if (alive.current) setSending(false); }
  };
  const title = targetUserId ? (partnerName || "利用者") : "chitose-bank運営";
  return <div ref={pageRef} className="chat-full chat-room f-sans">
    <header className="chat-room-header"><button onClick={onBack} aria-label="メッセージ一覧に戻る" className="chat-icon-button">←</button><div className="chat-row-content"><strong>{title}</strong><p style={{ fontSize:12, margin:4 }}>{targetUserId ? "運営として返信" : "運営へのお問い合わせ"}</p></div><button className="chat-text-button" onClick={() => openSupport({ topic: "chat", view: "compose" })}>この画面を報告</button></header>
    {loadError && <div role="alert" className="chat-notice">{loadError}<br/><button className="chat-text-button" onClick={load}>再読み込み</button></div>}
    <div ref={scrollRef} className="chat-messages" aria-label="運営との会話" onScroll={event => { const element = event.currentTarget; nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
      {loading ? <p className="chat-empty" aria-busy="true">読み込み中<Dots /></p> : denied ? <p className="chat-empty">このページは運営専用です。</p> : !msgs.length && !loadError ? <p className="chat-empty">困ったことや気づいたことを、運営にお知らせください。</p> : msgs.map((message, index) => <div key={message.id} style={{ display:"contents" }}>
        {(!index || chatDay(msgs[index - 1].created_at) !== chatDay(message.created_at)) && <p className="chat-day">{chatDay(message.created_at)}</p>}
        <div className={`chat-bubble${isMine(message) ? " is-mine" : ""}`}><LinkifiedText text={message.body}/></div><span className={`chat-message-time${isMine(message) ? " is-mine" : ""}`}>{chatTime(message.created_at)}</span>
      </div>)}
    </div>
    {error && <div className="chat-notice" role="alert">{error}<button className="chat-text-button" disabled={sending} onClick={send}>同じ内容で再送</button></div>}
    {!denied && <div className="chat-composer"><div className="chat-composer-row"><textarea aria-label="運営へのメッセージ" rows={2} value={text} disabled={!uidRef.current} readOnly={!!pending || sending} onChange={event => change(event.target.value)} placeholder={targetUserId ? "運営として返信" : "運営へのメッセージ"}/><button className="chat-send" onClick={send} disabled={sending || !text.trim() || !uidRef.current}>{sending ? "送信中" : pending ? "再送" : "送信"}</button></div>{text && <p className="chat-draft-hint">未送信の内容は、このアプリを開いている間だけ下書きに残ります。</p>}</div>}
  </div>;
}
