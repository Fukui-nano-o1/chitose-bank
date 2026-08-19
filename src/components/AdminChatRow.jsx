// 運営チャット（運営DM）のスレッド行＋ポップアップ。
// 2026-08-19たきと指示「運営チャットを浮遊ボックスにするの撤回。チャット一覧に移植」＝
// 浮遊ボックス（2026-07-25〜2026-08-19）をやめ、チャット一覧の最上部の行に戻した。
// 中身（admin_messages・本人スレのみRLS・ポップアップ・リアルタイム・復帰時再取得）は
// 2026-07-16〜の実装のまま。行の見た目は一覧の他のスレッド行に合わせてある。
import { useState, useEffect, useRef } from "react";
import { closeReadNotifications } from "../lib/push";
import { supabase } from "../lib/supabase";
import { fmtJstShort } from "../lib/utils";
import { LinkifiedText } from "./ui";

export function AdminChatRow() {
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
        closeReadNotifications(["cb-dm"]); // 読んだら運営DMの通知も消す（2026-08-18・LINEと同じ設計）
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
  // 一覧に出す1行ぶんの下書き（プレビュー＝最後のメッセージ。無ければ使い方の一言）
  const last = dmMsgs.length ? dmMsgs[dmMsgs.length - 1] : null;
  const preview = last ? (last.from_admin ? "🛡 " : "") + String(last.body || "").replace(/\s+/g, " ") : "運営への連絡もここから送れます。";
  return (<>
    {/* 一覧の最上部の行（他のスレッド行と同じ形：アイコン40px・名前・未読バッジ・下に1行の要約） */}
    <button onClick={()=>{ setDmOpen(true); loadDm(true); }}
      className={"f-sans" + (dmUnread > 0 ? " cb-urgent-card" : "")}
      style={{ display:"flex", alignItems:"center", gap:12, width:"100%", minWidth:0, textAlign:"left", background:"#fff",
        border:"1px solid #EBEBEB", borderRadius:12, padding:"14px 16px", cursor:"pointer", marginBottom:10 }}>
      <span style={{ flexShrink:0, width:40, height:40, borderRadius:"50%", background:"#F0F7F3", border:"1px solid #DDEDE5", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, lineHeight:1 }}>🛡</span>
      <div style={{ minWidth:0, flex:1 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:6 }}>
          <p style={{ fontSize:14, fontWeight:700, color:"#222", margin:0, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>chitose-bank運営</p>
          {dmUnread > 0 && <span style={{ minWidth:22, height:22, borderRadius:11, background:"#E24B4A", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 6px", flexShrink:0, marginLeft:"auto" }}>{dmUnread}</span>}
          {/* 段階チップの位置には役割を出す（当事者チャットと見分けがつくように） */}
          <span style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, background:"#5B7B6D", color:"#fff", flexShrink:0 }}>運営</span>
        </div>
        <p style={{ fontSize:12, color:"#717171", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{preview}</p>
      </div>
    </button>
    {/* 運営DMスレッド（ポップアップ・ボックス外タップで閉じる） */}
    {dmOpen && (
      <div className="cb-lock-scroll" onClick={()=>setDmOpen(false)} style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
        <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
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
