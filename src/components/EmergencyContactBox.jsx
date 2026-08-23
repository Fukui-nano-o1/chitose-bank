// 緊急連絡先の入力（働き手・雇い手プロフィール編集で共用・2026-08-03たきと指示）。
// 保管は専用テーブル emergency_contacts（self-only）。他のプロフィール項目とは別テーブルなので、
// 保存もこの部品の中で完結させる（呼び出し元の save() を汚さない）。
// 開示は採用成立後・相手方のみ（contract_emergency_contact RPC）＝ContractEmergencyContact が表示側。
import { NavIconInline } from "./NavIcons";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { setCache } from "../lib/viewCache";
import { Dots } from "./ui";

// 既定は「本人」（2026-08-03たきと指示）＝緊急時はまずご本人に連絡する。家族等へは本人が変更する
const RELATIONS = ["本人", "家族", "配偶者", "親", "子", "兄弟姉妹", "親戚", "友人", "その他"];

// ★2026-08-19たきと指示「緊急連絡先必須を解除。代わりに新規登録で入力した氏名と電話番号を
//   デフォルトに。任意で変更できるようにする」＝どちらの役割でも任意。
//   初期値はDB側で入る（account_holders への登録時に seed_emergency_contact トリガーが
//   氏名・電話・関係「本人」で1行作る）。この画面は、その既定を見て変えるための場所。
export function EmergencyContactBox({ accent = "#00A86B", onSaved }) {
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showHelp, setShowHelp] = useState(false);   // 「これは？」で説明を展開（既定は畳む）
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data } = await supabase.from("emergency_contacts")
          .select("name,relation,phone").eq("auth_id", session.user.id).maybeSingle();
        if (data) { setName(data.name || ""); setRelation(data.relation || ""); setPhone(data.phone || ""); }
        else {
          // 行が無い時の保険（DBのトリガーより前に登録した人・登録前にこの画面を開いた人）。
          // 「本人」を既定に、氏名・電話は新規登録の内容を画面に出す＝保存を押すまでDBには入らない
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
      // confirmed_at＝本人がこの内容を確認して保存した時刻（2026-08-19 裁定D案）。
      // 自動初期登録（seed_emergency_contact）はこの列を書かないのでNULLのまま＝相手方に出ない。
      // ここで初めて時刻が入り、採用成立時に contract_emergency_contact が中身を返すようになる。
      const { error } = await supabase.from("emergency_contacts").upsert({
        auth_id: session.user.id,
        name: name.trim(), relation: relation.trim(), phone: phone.trim(),
        confirmed_at: new Date().toISOString(),
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
  if (loading) return <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0" }}>読み込み中<Dots /></p>;
  return (
    <>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222" }}>緊急連絡先</label>
        {/* 説明は既定でたたむ（2026-08-19たきと指示「これは？ボタンタップで展開」）＝
            画面を文字で埋めない。中身は消していない＝押せばいつでも読める */}
        <button type="button" onClick={()=>setShowHelp(v => !v)} aria-expanded={showHelp} className="f-sans"
          style={{ fontSize:11, fontWeight:700, color:"#717171", background:"#F2F2F2", border:"1px solid #EBEBEB",
                   borderRadius:20, padding:"3px 10px", cursor:"pointer", lineHeight:1.4 }}>
          {showHelp ? "閉じる" : "これは？"}
        </button>
      </div>
      {showHelp && (
        <p className="f-sans" style={{ fontSize:12, color:"#717171", marginBottom:10, lineHeight:1.6 }}>
          作業中のケガや事故など、<b>緊急時に連絡する先</b>です。
          <b>新規登録で入力したお名前と電話番号が、はじめから入っています</b>（関係は「本人」）。
          ご家族などに<b>変更することもできます（任意）</b>。<b>採用が決まった相手にだけ表示されます</b>
          （求人ページや一覧、応募の段階では表示されません）。
        </p>
      )}
      {/* ★第三者の同意のお願いだけは、実際に本人以外へ変えた時は畳まない＝
          必要になった場面で必ず目に入る（たたむのは説明であって注意ではない） */}
      {(showHelp || (relation && relation !== "本人")) && (
        <p className="f-sans" style={{ fontSize:11, color:"#B03A3A", background:"#FFF4F4", border:"1px solid #F3C9C9", borderRadius:8, padding:"8px 10px", margin:"0 0 12px", lineHeight:1.6 }}>
          ご家族など、ご本人以外の連絡先に変更するときは、<b>その方に伝えて同意を得たうえで</b>ご登録ください。
        </p>
      )}
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
      {saved && <p className="f-sans" style={{ fontSize:12, color:accent, textAlign:"center", marginTop:10 }}>保存しました <NavIconInline name="tick" size={12} style={{ verticalAlign:"-1.5px", marginRight:0 }} /></p>}
      <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", margin:"10px 0 0", lineHeight:1.5 }}>
        いつでも書き換え・空欄にできます。空欄にしても、応募や掲載はできます。
      </p>
    </>
  );
}
