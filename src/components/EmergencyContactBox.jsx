// 緊急連絡先の入力（働き手・雇い手プロフィール編集で共用・2026-08-03たきと指示）。
// 保管は専用テーブル emergency_contacts（self-only）。他のプロフィール項目とは別テーブルなので、
// 保存もこの部品の中で完結させる（呼び出し元の save() を汚さない）。
// 開示は採用成立後・相手方のみ（contract_emergency_contact RPC）＝ContractEmergencyContact が表示側。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { setCache } from "../lib/viewCache";
import { Dots } from "./ui";

// 既定は「本人」（2026-08-03たきと指示）＝緊急時はまずご本人に連絡する。家族等へは本人が変更する
const RELATIONS = ["本人", "家族", "配偶者", "親", "子", "兄弟姉妹", "親戚", "友人", "その他"];

// required＝応募に必要な項目として扱う面（働き手プロフィール・2026-08-17たきと裁定②「義務にする」）。
// 雇い手側は従来どおり任意so渡さない。表示の違いだけで、保存の中身・開示の範囲は同じ。
export function EmergencyContactBox({ accent = "#00A86B", onSaved, required = false }) {
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
        else {
          // 未登録なら「本人」を既定に（2026-08-03たきと指示）。氏名・電話は新規登録の内容を初期値として
          // 画面に出すだけ＝保存を押すまでDBには入らない・相手にも出ない（本人が確認して公開する原則）
          setRelation("本人");
          try {
            const { data: ah } = await supabase.from("account_holders")
              .select("full_name,contact_phone").eq("auth_id", session.user.id).maybeSingle();
            if (ah) {
              if ((ah.full_name || "").trim()) setName(ah.full_name.trim());
              if ((ah.contact_phone || "").trim()) setPhone(ah.contact_phone.trim());
            }
          } catch {}
        }
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
      // 名刺の未設定バッジ用キャッシュも更新（FarmerDashboard farm:hasEmergency・2026-08-14）。
      // 空欄で保存し直した時はfalseに戻す＝バッジが実態から乖離しない
      try { setCache("farm:hasEmergency", !!(name.trim() || phone.trim())); } catch {}
      setSaved(true); setTimeout(()=>setSaved(false), 2000);
      if (typeof onSaved === "function") onSaved({ name: name.trim(), relation: relation.trim(), phone: phone.trim() });
    } catch { setSaving(false); alert("保存に失敗しました。"); }
  };
  if (loading) return <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0" }}>読み込み中…</p>;
  return (
    <>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:2 }}>
        緊急連絡先
        {required && <span className="f-sans" style={{ marginLeft:6, fontSize:10, fontWeight:700, color:"#fff", background:"#E24B4A", borderRadius:4, padding:"2px 6px", verticalAlign:"middle" }}>応募に必要</span>}
      </label>
      {required && (
        <p className="f-sans" style={{ fontSize:12, color:"#B54A0E", background:"#FFF8EF", border:"1px solid #F0E1CC", borderRadius:8, padding:"8px 10px", margin:"6px 0 10px", lineHeight:1.7 }}>
          応募には緊急連絡先の登録が必要です。作業中の事故に備えるためで、<b>採用が決まった相手にだけ</b>表示されます。
        </p>
      )}
      <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:10, lineHeight:1.6 }}>
        作業中のケガや事故など、<b>緊急時に連絡する先</b>です。<b>既定はご本人</b>（あなた自身）です。
        ご家族などに変更することもできます。<b>採用が決まった相手にだけ表示されます</b>
        （求人ページや一覧、応募の段階では表示されません）。
      </p>
      <p className="f-sans" style={{ fontSize:11, color:"#B03A3A", background:"#FFF4F4", border:"1px solid #F3C9C9", borderRadius:8, padding:"8px 10px", margin:"0 0 12px", lineHeight:1.6 }}>
        ご家族など、ご本人以外の連絡先に変更するときは、<b>その方に伝えて同意を得たうえで</b>ご登録ください。
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
      <button onClick={save} disabled={saving} className="btn-primary f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, borderRadius:12 }}>{saving ? <>保存中<Dots /></> : "保存する"}</button>
      {saved && <p className="f-sans" style={{ fontSize:12, color:accent, textAlign:"center", marginTop:10 }}>保存しました ✓</p>}
      <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"10px 0 0", lineHeight:1.5 }}>
        {required
          ? "いつでも書き換えられます。空欄にすると、新しい応募ができなくなります（すでに届いた応募はそのままです）。"
          : "いつでも書き換え・空欄にできます。"}
      </p>
    </>
  );
}
