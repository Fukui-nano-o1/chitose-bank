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

export function AdminChatRow() {
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
export function AdminDmInboxRows() {
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
  if (!threads.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {threads.map((t, i) => (
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
  const [msgs, setMsgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false); // 運営以外が #/chat/admin/{uid} を開いた時
  const [partnerName, setPartnerName] = useState(null); // targetUserId のニックネーム（読めるまで「利用者」）
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const uidRef = useRef(null);
  const scrollRef = useRef(null);
  // 右スワイプで一覧へ戻る（LINEと同じ・2026-08-24たきと指示）。←と同じ行き先
  const pageRef = useRef(null);
  useSwipeBack(pageRef, onBack);
  // 自分の吹き出しか（運営として見ている時は from_admin が自分）
  const isMine = (m) => (targetUserId ? m.from_admin : !m.from_admin);
  const load = async (markRead) => {
    const r = await fetchDm(targetUserId);
    setLoading(false);
    if (!r) return;
    if (targetUserId && !isAdmin(r.user)) { setDenied(true); return; } // RLSでも読めない（0件になる）が、理由を出す
    uidRef.current = r.uid;
    setMsgs(r.msgs);
    const unread = r.msgs.filter(m => !isMine(m) && !m.read_at).length;
    if (markRead && unread > 0) {
      try {
        // 既読化＝相手からの分だけ（運営として見ている時は from_admin=false・自分のスレッドでは from_admin=true）
        await supabase.from("admin_messages").update({ read_at: new Date().toISOString() })
          .eq("user_id", targetUserId || r.uid).eq("from_admin", targetUserId ? false : true).is("read_at", null);
        setMsgs(prev => prev.map(m => (!isMine(m) && !m.read_at) ? { ...m, read_at: new Date().toISOString() } : m));
        window.dispatchEvent(new Event("cb:unreadRefresh"));
        if (!targetUserId) closeReadNotifications(["cb-dm"]); // 読んだら運営DMの通知も消す（2026-08-18・LINEと同じ設計）
      } catch {}
    }
  };
  useEffect(() => {
    setMsgs([]); setLoading(true); setDenied(false); setPartnerName(null);
    load(true);
    // 相手の名前（運営がスレッドを開いた時だけ・管理者RLSで読める。働き手名→雇い手名→利用者）
    if (targetUserId) {
      (async () => {
        try {
          const [w, e] = await Promise.all([
            supabase.from("worker_profiles").select("nickname").eq("auth_id", targetUserId).maybeSingle(),
            supabase.from("employer_profiles").select("nickname").eq("auth_id", targetUserId).maybeSingle(),
          ]);
          setPartnerName(w.data?.nickname || e.data?.nickname || null);
        } catch {}
      })();
    }
    const ch = supabase.channel("admin-dm-page" + (targetUserId ? "-" + targetUserId : ""))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_messages" }, () => load(true))
      .subscribe();
    const onWake = () => { if (document.visibilityState === "visible") load(true); };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [targetUserId]); // eslint-disable-line react-hooks/exhaustive-deps
  // 最新を下端に（当事者チャットと同じ見え方）
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length]);
  const send = async () => {
    const body = text.trim();
    const uid = uidRef.current;
    if (!body || sending || !uid) return;
    setSending(true);
    const row = targetUserId
      ? { user_id: targetUserId, from_admin: true, body }   // 運営としての返信（利用者側のスレッドに届く）
      : { user_id: uid, from_admin: false, body };          // 利用者としての連絡（従来どおり）
    const { data, error } = await supabase.from("admin_messages").insert(row).select().single();
    if (error) alert("送信に失敗しました：" + error.message);
    else { setText(""); if (data) setMsgs(prev => prev.some(m => m.id === data.id) ? prev : [...prev, data]); }
    setSending(false);
  };
  const title = targetUserId ? ((partnerName || "利用者") + "さん（運営として返信）") : "chitose-bank運営";
  return (
    <div ref={pageRef} className="chat-full" style={{ maxWidth:600, marginLeft:"auto", marginRight:"auto", display:"flex", flexDirection:"column" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 0 10px", borderBottom:"1px solid #EEE" }}>
        <button onClick={onBack} aria-label="戻る" className="f-sans" style={{ background:"none", border:"none", color:"#717171", fontSize:20, cursor:"pointer", padding:"4px 4px", flexShrink:0, lineHeight:1 }}>←</button>
        <p className="f-sans" style={{ flex:1, minWidth:0, fontSize:15, fontWeight:700, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{!targetUserId && <NavIconInline name="support" size={15} />}{title}</p>
      </div>
      <div ref={scrollRef} style={{ flex:1, minHeight:0, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"14px 0", display:"flex", flexDirection:"column", gap:10 }}>
        {loading ? (
          <p className="f-sans" style={{ fontSize:13, color:"#999", textAlign:"center", padding:"32px 0" }}>読み込み中<Dots /></p>
        ) : denied ? (
          <p className="f-sans" style={{ fontSize:13, color:"#999", textAlign:"center", padding:"32px 0" }}>このページは運営専用です。</p>
        ) : msgs.length === 0 ? (
          <p className="f-sans" style={{ fontSize:13, color:"#999", textAlign:"center", padding:"32px 0" }}>{targetUserId ? "まだメッセージはありません。" : "まだメッセージはありません。運営への連絡もここから送れます。"}</p>
        ) : msgs.map(m => (
          <div key={m.id} style={{ alignSelf: isMine(m) ? "flex-end" : "flex-start", maxWidth:"85%" }}>
            {m.from_admin && !targetUserId && <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"0 0 2px" }}><NavIconInline name="support" size={10} />運営</p>}
            <div className="f-sans" style={{ background: isMine(m) ? "#00A86B" : "#F5F5F5", color: isMine(m) ? "#fff" : "#222", borderRadius:14, padding:"10px 14px", fontSize:14, lineHeight:1.7, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}><LinkifiedText text={m.body} /></div>
            <p className="f-sans" style={{ fontSize:10, color:"#C8C8C8", margin:"3px 2px 0", textAlign: isMine(m) ? "right" : "left" }}>{fmtJstShort(m.created_at)}</p>
          </div>
        ))}
      </div>
      {!denied && (
      <div style={{ display:"flex", gap:8, padding:"10px 0 calc(10px + env(safe-area-inset-bottom, 0px))", borderTop:"1px solid #F0F0F0", flexShrink:0 }}>
        <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{ if (e.key === "Enter") send(); }} placeholder={targetUserId ? "運営として返信" : "運営へのメッセージ"} className="field f-sans" style={{ flex:1, marginBottom:0, fontSize:14 }} />
        <button onClick={send} disabled={sending || !text.trim()} className="btn-primary f-sans" style={{ padding:"0 18px", fontSize:14, fontWeight:700, opacity: (sending || !text.trim()) ? 0.5 : 1 }}>送信</button>
      </div>
      )}
    </div>
  );
}
