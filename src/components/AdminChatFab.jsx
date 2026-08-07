// 運営チャットの浮遊ボックス＋DMスレッド（2026-08-07：ChatListから共有部品へ切り出し）。
// たきと指示「応募者ページのステータス絞り込みを導入しよう。その上に運営チャット配置」＝
// チャット一覧以外のページにも置けるようにする。中身（admin_messages・本人スレのみRLS・
// ポップアップ・リアルタイム・復帰時再取得）は2026-07-16〜の実装をそのまま移設。
// raised: 応募者ページ用＝絞り込みバー(.cb-applicant-filter-bar)の真上に浮かせる（モバイルのみ・CSS側）
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { fmtJstShort } from "../lib/utils";
import { LinkifiedText } from "./ui";

export function AdminChatFab({ raised }) {
  const [dmOpen, setDmOpen] = useState(false);
  const [dmMsgs, setDmMsgs] = useState([]);
  const [dmUnread, setDmUnread] = useState(0);
  const [dmText, setDmText] = useState("");
  const [dmSending, setDmSending] = useState(false);
  const dmUid = useRef(null);
  const dmOpenRef = useRef(false);
  useEffect(() => { dmOpenRef.current = dmOpen; }, [dmOpen]);
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
  useEffect(() => {
    loadDm(false);
    // リアルタイム（2026-07-19）＋復帰時の再取得（2026-07-27・iOS PWAのWebSocket凍結対策）
    const ch = supabase.channel("admin-dm-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_messages" }, () => loadDm(dmOpenRef.current))
      .subscribe();
    const onWake = () => { if (document.visibilityState === "visible") loadDm(dmOpenRef.current); };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
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
  return (<>
    {/* 浮遊ボックス（2026-07-25たきと指示・一覧の最上部行から移設） */}
    <button onClick={()=>{ setDmOpen(true); loadDm(true); }}
      className={"f-sans cb-admin-chat-fab" + (raised ? " cb-admin-chat-fab-raised" : "") + (dmUnread > 0 ? " cb-urgent-card" : "")}
      style={{ position:"fixed", right:12, bottom:"calc(64px + 12px + env(safe-area-inset-bottom, 0px))", zIndex:1200, display:"flex", alignItems:"center", gap:8, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"10px 14px", cursor:"pointer", boxShadow:"0 4px 16px rgba(0,0,0,0.15)" }}>
      <span style={{ fontSize:18, lineHeight:1 }}>🛡</span>
      <span style={{ fontSize:13, fontWeight:700, color:"#222" }}>運営チャット</span>
      {dmUnread > 0 && <span style={{ minWidth:20, height:20, borderRadius:10, background:"#E24B4A", color:"#fff", fontSize:11, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 6px" }}>{dmUnread}</span>}
    </button>
    {/* 運営DMスレッド（ポップアップ・✕/背景で閉じる） */}
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
  </>);
}
