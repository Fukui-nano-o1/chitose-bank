// 💬この画面を報告（意見・要望）。第2次構造改革2026-08-17でApp.jsxから移設・中身は不変。
// ★保存先は feedback テーブル（category CHECK制約と FEEDBACK_CATEGORIES が対応）。
//   表示側は components/admin/AdminReportsRoom.jsx。片方を直したらもう片方も合わせる。
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { Dots } from "../../components/ui";

// 💬この画面を報告（Part B）。feedbackテーブルのcategory CHECK制約と対応
const FEEDBACK_CATEGORIES = [
  { v:"confusing",   l:"分かりにくい" },
  { v:"broken",      l:"動かない" },
  { v:"typo",        l:"誤字・表示" },
  { v:"suggestion",  l:"提案" },
  { v:"other",       l:"その他" },
];

// この画面を報告（Part B）のモーダル本体。☰の開閉やヘルプの章開閉と無関係な階層（App直下）に
// 1個だけ常駐させ、open/onCloseで外部から制御する。過去バージョンはトリガーボタンと同居させていたため、
// ☰を閉じるとトリガーごとアンマウントされモーダルが開かないバグがあった（2026-07-14修正）
export function FeedbackModal({ open, onClose }) {
  const [category, setCategory] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (open) { setCategory(""); setBody(""); setSent(false); }
  }, [open]);
  const submit = async () => {
    if (!category || submitting) return;
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSubmitting(false); return; }
      const { error } = await supabase.from('feedback').insert({
        reporter_id: session.user.id,
        page_hash: window.location.hash || '#/',
        category, body: body.trim() || null,
        viewport: window.innerWidth,
      });
      if (error) { alert('送信に失敗しました：' + error.message); setSubmitting(false); return; }
      setSent(true);
    } catch { alert('送信に失敗しました。'); }
    setSubmitting(false);
  };
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"100%", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        {sent ? (
          <>
            <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700, textAlign:"center", padding:"20px 0", margin:0 }}>ありがとうございます。改善に使わせていただきます</p>
            <button onClick={onClose} className="btn-primary f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, borderRadius:10 }}>閉じる</button>
          </>
        ) : (
          <>
            <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:12 }}>この画面を報告</p>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
              {FEEDBACK_CATEGORIES.map(c => (
                <button key={c.v} type="button" onClick={() => setCategory(c.v)} className="f-sans" style={{
                  padding:"7px 14px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer", border:"2px solid",
                  borderColor: category===c.v ? "#00A86B" : "#EBEBEB",
                  background: category===c.v ? "#E6F7EF" : "#fff", color: category===c.v ? "#00A86B" : "#222",
                }}>{c.l}</button>
              ))}
            </div>
            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="どの部分が、どうでしたか？" rows={4}
              className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:8 }} />
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.6, marginBottom:16 }}>操作の記録としてページ名が運営に送られます</p>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={onClose} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
              <button onClick={submit} disabled={submitting || !category} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background: category ? "#00A86B" : "#EBEBEB", color: category ? "#fff" : "#717171", border:"none", borderRadius:10, cursor:"pointer" }}>{submitting ? <>送信中<Dots /></> : "送信する"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
