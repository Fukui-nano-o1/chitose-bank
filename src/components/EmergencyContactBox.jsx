// 緊急連絡先の入力（働き手・雇い手プロフィール編集で共用・2026-08-03たきと指示）。
// 保管は専用テーブル emergency_contacts（self-only）。他のプロフィール項目とは別テーブルなので、
// 保存もこの部品の中で完結させる（呼び出し元の save() を汚さない）。
// 開示は採用成立後・相手方のみ（contract_emergency_contact RPC）＝ContractEmergencyContact が表示側。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const RELATIONS = ["家族", "配偶者", "親", "子", "兄弟姉妹", "親戚", "友人", "その他"];

export function EmergencyContactBox({ accent = "#00A86B", onSaved }) {
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data } = await supabase.from("emergency_contacts")
          .select("name,relation,phone").eq("auth_id", session.user.id).maybeSingle();
        if (data) { setName(data.name || ""); setRelation(data.relation || ""); setPhone(data.phone || ""); }
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
      const { error } = await supabase.from("emergency_contacts").upsert({
        auth_id: session.user.id,
        name: name.trim(), relation: relation.trim(), phone: phone.trim(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "auth_id" });
      setSaving(false);
      if (error) { alert("保存に失敗しました：" + error.message); return; }
      setSaved(true); setTimeout(()=>setSaved(false), 2000);
      if (typeof onSaved === "function") onSaved({ name: name.trim(), relation: relation.trim(), phone: phone.trim() });
    } catch { setSaving(false); alert("保存に失敗しました。"); }
  };
  if (loading) return <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0" }}>読み込み中…</p>;
  return (
    <>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>緊急連絡先</label>
      <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:10, lineHeight:1.6 }}>
        作業中のケガや事故など、<b>緊急時に連絡する先</b>です。<b>採用が決まった相手にだけ表示されます</b>
        （求人ページや一覧、応募の段階では表示されません）。
      </p>
      <p className="f-sans" style={{ fontSize:11, color:"#B03A3A", background:"#FFF4F4", border:"1px solid #F3C9C9", borderRadius:8, padding:"8px 10px", margin:"0 0 12px", lineHeight:1.6 }}>
        ご家族など、ご本人以外の連絡先を登録するときは、<b>その方に伝えて同意を得たうえで</b>ご登録ください。
      </p>
      <label className="f-sans" style={{ fontSize:11, fontWeight:600, color:"#717171", display:"block", marginBottom:4 }}>お名前</label>
      <input value={name} onChange={e=>setName(e.target.value)} placeholder="例：山田 花子" maxLength={100}
        className="field f-sans" style={{ width:"100%", fontSize:16, boxSizing:"border-box", marginBottom:10 }} />
      <label className="f-sans" style={{ fontSize:11, fontWeight:600, color:"#717171", display:"block", marginBottom:4 }}>あなたとの関係</label>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
        {RELATIONS.map(v => (
          <button key={v} type="button" onClick={()=>setRelation(relation === v ? "" : v)} className="f-sans" style={{
            padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
            border:"1px solid " + (relation === v ? accent : "#EBEBEB"),
            background: relation === v ? "#F0F7F4" : "#F7F7F7",
            color: relation === v ? accent : "#717171",
          }}>{v}</button>
        ))}
      </div>
      <label className="f-sans" style={{ fontSize:11, fontWeight:600, color:"#717171", display:"block", marginBottom:4 }}>電話番号</label>
      <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="例：090-0000-0000" maxLength={30} inputMode="tel"
        className="field f-sans" style={{ width:"100%", fontSize:16, boxSizing:"border-box", marginBottom:14 }} />
      <button onClick={save} disabled={saving} className="btn-primary f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12 }}>{saving ? "保存中..." : "緊急連絡先を保存する"}</button>
      {saved && <p className="f-sans" style={{ fontSize:12, color:accent, textAlign:"center", marginTop:10 }}>保存しました ✓</p>}
      <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"10px 0 0", lineHeight:1.5 }}>
        この項目はプロフィールの他の内容とは別に保存されます。いつでも書き換え・空欄にできます。
      </p>
    </>
  );
}
