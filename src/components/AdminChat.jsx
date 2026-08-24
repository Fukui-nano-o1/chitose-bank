// 運営チャット（運営DM）＝一覧の行（AdminChatRow）と、そのスレッドのページ（AdminChatPage）。
// 2026-08-24たきと指示「運営だけボックス展開はおかしい。ページ遷移だ。運営チャットは新しいリンクを」＝
// ポップアップ（2026-07-16〜）をやめ、当事者チャットと同じ【ページ】にした。リンクは #/chat/admin
// （★App.jsx の chatAppId は /^chat\/(admin|uuid)$/ で拾う。"admin" は uuid の文字集合 [0-9a-f-] に
//  当たらないので当事者チャットとは衝突しない。この1つの器に相乗りしたので、既存の !chatAppId ガード
//  ・トーストの抑止・readHashTab が全部そのまま効く＝新しい判定を増やしていない）。
// 中身（admin_messages・本人スレのみRLS・リアルタイム・復帰時再取得・既読化）は従来のまま。
import { useState, useEffect, useRef } from "react";
import { closeReadNotifications } from "../lib/push";
import { supabase } from "../lib/supabase";
import { fmtJstShort } from "../lib/utils";
import { LinkifiedText, Dots } from "./ui";
import { NavIcon, NavIconInline } from "./NavIcons";

export const ADMIN_CHAT_HASH = "/chat/admin";

// 運営DMの読み書きの唯一の窓口（行とページで共有＝取得の形を2つ持たない）
async function fetchDm() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.from("admin_messages").select("*").eq("user_id", session.user.id).order("created_at", { ascending: true });
  if (error) return null; // 失敗時は手元の値を上書きしない（2026-08-07のフェイルオープン規則）
  return { uid: session.user.id, msgs: data || [] };
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
    <button onClick={()=>{ window.location.hash = ADMIN_CHAT_HASH; }}
      className={"f-sans" + (unread > 0 ? " cb-urgent-card" : "")}
      style={{ display:"flex", alignItems:"center", gap:12, width:"100%", minWidth:0, textAlign:"left", background:"#fff",
        border:"1px solid #EBEBEB", borderRadius:12, padding:"14px 16px", cursor:"pointer", marginBottom:10 }}>
      <span style={{ flexShrink:0, width:40, height:40, borderRadius:"50%", background:"#F0F7F3", border:"1px solid #DDEDE5", display:"flex", alignItems:"center", justifyContent:"center", color:"#00A86B" }}><NavIcon name="support" size={20} /></span>
      <div style={{ minWidth:0, flex:1 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:6 }}>
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

// 運営DMのスレッドページ（#/chat/admin）。器は当事者チャットと同じ .chat-full
// ＝下部バー・ヘッダー・フッターが隠れ、ページ自体はスクロールせず中のメッセージ欄だけが動く
export function AdminChatPage({ onBack }) {
  const [msgs, setMsgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const uidRef = useRef(null);
  const scrollRef = useRef(null);
  const load = async (markRead) => {
    const r = await fetchDm();
    setLoading(false);
    if (!r) return;
    uidRef.current = r.uid;
    setMsgs(r.msgs);
    const unread = r.msgs.filter(m => m.from_admin && !m.read_at).length;
    if (markRead && unread > 0) {
      try {
        await supabase.from("admin_messages").update({ read_at: new Date().toISOString() }).eq("user_id", r.uid).eq("from_admin", true).is("read_at", null);
        setMsgs(prev => prev.map(m => (m.from_admin && !m.read_at) ? { ...m, read_at: new Date().toISOString() } : m));
        window.dispatchEvent(new Event("cb:unreadRefresh"));
        closeReadNotifications(["cb-dm"]); // 読んだら運営DMの通知も消す（2026-08-18・LINEと同じ設計）
      } catch {}
    }
  };
  useEffect(() => {
    load(true);
    const ch = supabase.channel("admin-dm-page")
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
  }, []);
  // 最新を下端に（当事者チャットと同じ見え方）
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length]);
  const send = async () => {
    const body = text.trim();
    const uid = uidRef.current;
    if (!body || sending || !uid) return;
    setSending(true);
    const { data, error } = await supabase.from("admin_messages").insert({ user_id: uid, from_admin: false, body }).select().single();
    if (error) alert("送信に失敗しました：" + error.message);
    else { setText(""); if (data) setMsgs(prev => prev.some(m => m.id === data.id) ? prev : [...prev, data]); }
    setSending(false);
  };
  return (
    <div className="chat-full" style={{ maxWidth:600, marginLeft:"auto", marginRight:"auto", display:"flex", flexDirection:"column" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 0 10px", borderBottom:"1px solid #EEE" }}>
        <button onClick={onBack} aria-label="戻る" className="f-sans" style={{ background:"none", border:"none", color:"#717171", fontSize:20, cursor:"pointer", padding:"4px 4px", flexShrink:0, lineHeight:1 }}>←</button>
        <p className="f-sans" style={{ flex:1, minWidth:0, fontSize:15, fontWeight:700, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}><NavIconInline name="support" size={15} />chitose-bank運営</p>
      </div>
      <div ref={scrollRef} style={{ flex:1, minHeight:0, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"14px 0", display:"flex", flexDirection:"column", gap:10 }}>
        {loading ? (
          <p className="f-sans" style={{ fontSize:13, color:"#999", textAlign:"center", padding:"32px 0" }}>読み込み中<Dots /></p>
        ) : msgs.length === 0 ? (
          <p className="f-sans" style={{ fontSize:13, color:"#999", textAlign:"center", padding:"32px 0" }}>まだメッセージはありません。運営への連絡もここから送れます。</p>
        ) : msgs.map(m => (
          <div key={m.id} style={{ alignSelf: m.from_admin ? "flex-start" : "flex-end", maxWidth:"85%" }}>
            {m.from_admin && <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"0 0 2px" }}><NavIconInline name="support" size={10} />運営</p>}
            <div className="f-sans" style={{ background: m.from_admin ? "#F5F5F5" : "#00A86B", color: m.from_admin ? "#222" : "#fff", borderRadius:14, padding:"10px 14px", fontSize:14, lineHeight:1.7, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}><LinkifiedText text={m.body} /></div>
            <p className="f-sans" style={{ fontSize:10, color:"#C8C8C8", margin:"3px 2px 0", textAlign: m.from_admin ? "left" : "right" }}>{fmtJstShort(m.created_at)}</p>
          </div>
        ))}
      </div>
      <div style={{ display:"flex", gap:8, padding:"10px 0 calc(10px + env(safe-area-inset-bottom, 0px))", borderTop:"1px solid #F0F0F0", flexShrink:0 }}>
        <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{ if (e.key === "Enter") send(); }} placeholder="運営へのメッセージ" className="field f-sans" style={{ flex:1, marginBottom:0, fontSize:14 }} />
        <button onClick={send} disabled={sending || !text.trim()} className="btn-primary f-sans" style={{ padding:"0 18px", fontSize:14, fontWeight:700, opacity: (sending || !text.trim()) ? 0.5 : 1 }}>送信</button>
      </div>
    </div>
  );
}
