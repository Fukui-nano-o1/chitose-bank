// 訪問者の玄関（#/visit・恒久URL）／QRページ／保険の準備ページ（分割・段階2で切り出し・2026-07-24）。
// /#/visit は印刷物に焼かれた恒久URL＝ルート文字列・遷移先の意味を変えない（CLAUDE.md絶対遵守）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { INSURANCE_ITEMS } from "../lib/utils";
import { ToggleSwitch } from "./ToggleSwitch";
// 🛡 保険の準備（自己申告）専用ページ（#/insurance・2026-07-24）：農家プロフィール編集の箱から独立ページへ。
// employer_profiles.insurance_items を単独upsert（onConflictで当該列のみ更新＝他項目は温存）。
export function InsurancePrepPage({ me }) {
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState({}); // { key: 農家の自由記述メモ }。求人の🛡保険タブで定型説明の下に出す
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data } = await supabase.from("employer_profiles").select("insurance_items,insurance_notes").eq("auth_id", session.user.id).maybeSingle();
        setItems(Array.isArray(data?.insurance_items) ? data.insurance_items : []);
        setNotes((data?.insurance_notes && typeof data.insurance_notes === "object") ? data.insurance_notes : {});
      } catch {}
      setLoading(false);
    })();
  }, []);
  const save = async () => {
    if (saving) return;
    setSaving(true); setSaved(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSaving(false); return; }
      // メモは「選択中の項目」の空でないものだけ保存（外した項目のメモは残さない＝表示と保存の一致）
      const prunedNotes = {};
      items.forEach(k => { const t = (notes[k] || "").trim(); if (t) prunedNotes[k] = t; });
      const { error } = await supabase.from("employer_profiles").upsert({ auth_id: session.user.id, insurance_items: items, insurance_notes: prunedNotes, updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
      setSaving(false);
      if (error) { alert("保存に失敗しました：" + error.message); return; }
      setSaved(true); setTimeout(()=>setSaved(false), 2000);
    } catch { setSaving(false); alert("保存に失敗しました"); }
  };
  return (
    <div className="help-edge" style={{ maxWidth:560, margin:"0 auto", padding:"24px 4px 96px" }}>
      <button onClick={()=>{ let fromApp=false; try{ fromApp=sessionStorage.getItem("cb_insFromApp")==="1"; sessionStorage.removeItem("cb_insFromApp"); }catch{} if (fromApp && window.history.length>1) window.history.back(); else window.location.hash="/profile/employer"; }} className="f-sans" style={{ background:"none", border:"none", color:"#717171", fontSize:14, cursor:"pointer", padding:"4px 0 14px", display:"inline-flex", alignItems:"center", gap:6 }}>← 戻る</button>
      <h1 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#222", margin:"0 0 6px" }}>🛡 保険の準備（自己申告）</h1>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:"0 0 20px", lineHeight:1.7 }}>当てはまるものを選べます（複数可）。あなたの求人・プロフィールに「農家の自己申告」として表示されます。運営が確認するものではありません。選んだ項目には、働き手向けのひとことを添えられます（任意）。</p>
      {loading ? (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>読み込み中...</p>
      ) : (<>
        <div style={{ borderTop:"1px solid #EBEBEB", marginBottom:16 }}>
          {INSURANCE_ITEMS.map((it, i) => (
            <div key={it.k} style={{ borderBottom: i < INSURANCE_ITEMS.length - 1 ? "1px solid #EBEBEB" : "none" }}>
              <ToggleSwitch label={it.label} checked={items.includes(it.k)} onChange={(v)=>setItems(prev => v ? [...new Set([...prev, it.k])] : prev.filter(x => x !== it.k))} />
              {items.includes(it.k) && (
                <div style={{ padding:"0 2px 12px" }}>
                  <textarea
                    value={notes[it.k] || ""}
                    onChange={e=>setNotes(prev => ({ ...prev, [it.k]: e.target.value }))}
                    placeholder="働き手へのひとこと（任意・例：加入している保険会社や補償の範囲など）"
                    rows={2}
                    maxLength={300}
                    className="field f-sans"
                    style={{ fontSize:13, resize:"vertical", width:"100%", boxSizing:"border-box" }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
        {items.includes("considering") && (
          <button onClick={()=>{ window.location.hash="/help/faq"; }} className="f-sans" style={{ background:"none", border:"none", padding:0, color:"#00A86B", fontSize:13, fontWeight:700, textDecoration:"underline", cursor:"pointer", marginBottom:16 }}>→ 1日保険の入り方（ヘルプ）</button>
        )}
        <button onClick={save} disabled={saving} className="btn-primary f-sans" style={{ width:"100%", padding:"15px", fontSize:15, fontWeight:700, borderRadius:12 }}>{saving ? "保存中..." : "保存する"}</button>
        {saved && <p className="f-sans" style={{ fontSize:12, color:"#00A86B", textAlign:"center", marginTop:12 }}>保存しました ✓</p>}
      </>)}
    </div>
  );
}

// 訪問者の玄関（#/visit・恒久URL・2026-07-24）：ロゴ＋一言＋規約/プラポリ＋「同意して見てみる」。
// 同意はlocalStorageに記録し、再訪問・ログイン済みは玄関をスキップ。同意後は、全入口ゲートが退避した
// 元の宛先（cb_visitReturn）へ戻す（無ければ#/searchへ）。
export function VisitEntrance({ me }) {
  // 玄関に着いた時点で既に同意済み/ログイン済みなら、退避先（あれば）へ、無ければ検索へ直行
  const nextDest = () => {
    let dest = "/search";
    try { const r = localStorage.getItem("cb_visitReturn"); if (r) dest = "/" + r; localStorage.removeItem("cb_visitReturn"); } catch {}
    return dest;
  };
  useEffect(() => {
    let consent = false; try { consent = localStorage.getItem("cb_visitConsent") === "1"; } catch {}
    if (me || consent) { window.location.hash = nextDest(); }
  }, [me]);
  const agree = () => { try { localStorage.setItem("cb_visitConsent", "1"); } catch {} window.location.hash = nextDest(); };
  return (
    <div style={{ maxWidth:520, margin:"0 auto", padding:"56px 20px 96px", textAlign:"center" }}>
      <img src="/favicon.svg" alt="chitose-bank" style={{ width:76, height:76, marginBottom:16 }} />
      <h1 className="f-sans" style={{ fontSize:26, fontWeight:800, color:"#222", margin:"0 0 10px" }}>chitose-bank</h1>
      <p className="f-sans" style={{ fontSize:16, color:"#555", lineHeight:1.9, margin:"0 0 30px" }}>農家と働き手が直接つながる、農作業の求人サイトです。</p>
      <div style={{ display:"flex", justifyContent:"center", gap:20, marginBottom:26 }}>
        <button onClick={()=>{ window.location.hash="/terms"; }} className="f-sans" style={{ background:"none", border:"none", color:"#00A86B", fontSize:14, fontWeight:600, textDecoration:"underline", cursor:"pointer", padding:0 }}>利用規約</button>
        <button onClick={()=>{ window.location.hash="/privacy"; }} className="f-sans" style={{ background:"none", border:"none", color:"#00A86B", fontSize:14, fontWeight:600, textDecoration:"underline", cursor:"pointer", padding:0 }}>プライバシーポリシー</button>
      </div>
      <button onClick={agree} className="btn-primary f-sans" style={{ width:"100%", maxWidth:320, padding:"16px", fontSize:16, fontWeight:700, borderRadius:14 }}>同意して見てみる</button>
      <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"14px auto 0", maxWidth:340, lineHeight:1.8 }}>「同意して見てみる」を押すと、利用規約とプライバシーポリシーに同意したものとします。求人の閲覧ができます（応募・登録は会員のみ）。</p>
    </div>
  );
}

// 管理者用QRコードページ（#/qr・2026-07-24）：焼き込み済みの静的QR(public/visit-qr.svg)を表示。実行時生成しない。
export function VisitorQRPage() {
  const url = "https://chitose-bank.com/#/visit";
  return (
    <div style={{ maxWidth:520, margin:"0 auto", padding:"40px 20px 96px", textAlign:"center" }}>
      <h1 className="f-sans qr-noprint" style={{ fontSize:24, fontWeight:800, color:"#222", margin:"0 0 12px" }}>📇 QRコード</h1>
      <p className="f-sans qr-noprint" style={{ fontSize:12, color:"#C77700", background:"#FFF7E6", border:"1px solid #FFE0A3", borderRadius:10, padding:"10px 12px", margin:"0 0 22px", lineHeight:1.8, textAlign:"left" }}>このQRは印刷物に配布済み。画像とURLは永久に変更しないこと（恒久URL /#/visit）。</p>
      <div className="qr-print-area">
        <img src="/visit-qr.svg" alt="訪問者用QRコード" style={{ width:"min(72vw, 320px)", height:"auto", imageRendering:"pixelated", display:"block", margin:"0 auto" }} />
        <p className="f-mono" style={{ fontSize:14, color:"#222", margin:"16px 0 0", wordBreak:"break-all" }}>{url}</p>
        <p className="f-sans qr-print-only" style={{ fontSize:20, fontWeight:800, color:"#222", margin:"26px 0 4px" }}>chitose-bank</p>
        <p className="f-sans qr-print-only" style={{ fontSize:14, color:"#555", margin:0 }}>農家と働き手が直接つながる、農作業の求人サイトです。</p>
      </div>
      <button onClick={()=>window.print()} className="btn-primary f-sans qr-noprint" style={{ marginTop:26, padding:"14px 32px", fontSize:15, fontWeight:700, borderRadius:12 }}>🖨 印刷</button>
    </div>
  );
}
