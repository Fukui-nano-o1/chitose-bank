// 保険の準備（自己申告）の編集ボックス。
// 2026-08-25たきと指示「保険の準備はプロフィール編集ページに移設。同じ構造にして表示。
// マイページの保険の準備は削除」＝マイページの反転カード（2026-07-29）を畳み、
// 雇い手プロフィール編集の格子の1ボックスにした。
// ★保存はこの部品の中で完結する（employer_profiles の insurance_items / insurance_notes だけを upsert）＝
//   緊急連絡先（EmergencyContactBox）と同じ作法。編集ページの共通「保存する」には載せない
//   （委託レーン＝consignment_profiles にはこの2列が無いため、共通の payload に混ぜると委託側の保存が落ちる）。
// ★中身（1項目=1ボックス・トグル・ひとこと・排他ルール）は保険の準備ページ（#/insurance・
//   VisitAndInsurance の InsurancePrepPage）と同じ＝申告の形をサイト内で2種類にしない。
//   排他ルールの本体は lib/utils の insuranceToggle（3画面で共用）。
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { INSURANCE_ITEMS, insuranceToggle } from "../lib/utils";
import { ToggleSwitch } from "./ToggleSwitch";
import { Dots } from "./ui";

// 格子カードの要約（申告ずみの項目名を並べる）。編集ページと同じ形で使えるよう外に出す
export const insuranceSummary = (items) =>
  (Array.isArray(items) ? items : [])
    .map(k => (INSURANCE_ITEMS.find(x => x.k === k) || {}).chip)
    .filter(Boolean)
    .join("・");

export function InsurancePrepBox({ accent = "#00A86B", onSaved }) {
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!live) return;
        if (!session) { setLoading(false); return; }
        const { data } = await supabase.from("employer_profiles")
          .select("insurance_items,insurance_notes").eq("auth_id", session.user.id).maybeSingle();
        if (!live) return;
        setItems(Array.isArray(data?.insurance_items) ? data.insurance_items : []);
        setNotes((data?.insurance_notes && typeof data.insurance_notes === "object") ? data.insurance_notes : {});
      } catch {}
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, []);

  // 排他ルール（「これから準備する」は他と両立しない）は lib/utils に一本化。
  // 消えるものがある時だけ一度確認する（文言も保険の準備ページと同じ）
  const toggleItem = (k, v) => {
    const r = insuranceToggle(items, notes, k, v);
    if (r.losing && !window.confirm("「これから準備する」を選ぶと、他の保険の選択と入力したひとことはリセットされます。よろしいですか？")) return;
    setItems(r.items); setNotes(r.notes);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true); setSaved(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSaving(false); return; }
      // ひとことは選択中の項目のぶんだけ残す（外した項目のメモは持ち越さない＝表示と保存の一致）
      const pruned = {};
      items.forEach(k => { const t = (notes[k] || "").trim(); if (t) pruned[k] = t; });
      const { error } = await supabase.from("employer_profiles")
        .upsert({ auth_id: session.user.id, insurance_items: items, insurance_notes: pruned, updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
      setSaving(false);
      if (error) { alert("保存に失敗しました：" + error.message); return; }
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      if (typeof onSaved === "function") onSaved({ items, notes: pruned });
    } catch { setSaving(false); alert("保存に失敗しました"); }
  };

  if (loading) return <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>読み込み中<Dots /></p>;

  return (
    <>
      <label className="f-sans" style={{ fontSize:12, fontWeight:600, color:"#222", display:"block", marginBottom:6 }}>保険の準備（自己申告）</label>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 12px", lineHeight:1.7 }}>
        働き手のケガに備える保険の準備方針です。当てはまるものを選べます（複数可）。
        あなたの求人ページとプロフィールに「農家の自己申告」として表示されます。運営が確認するものではありません。
        選んだ項目には、働き手向けのひとことを添えられます（任意）。
      </p>
      {/* 1項目=1ボックス（保険の準備ページと同じ形）。申告した項目は縁が役割色。
          「これから準備する」を選んでいる間は他の箱を出さない＝排他を見た目でも表す */}
      <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
        {(items.includes("considering") ? INSURANCE_ITEMS.filter(it => it.k === "considering") : INSURANCE_ITEMS).map(it => {
          const on = items.includes(it.k);
          return (
            <div key={it.k} style={{ background:"#F7F7F7", border:"1px solid " + (on ? accent : "#EBEBEB"), borderRadius:14, padding:"2px 14px 6px" }}>
              <ToggleSwitch label={it.label} checked={on} onChange={(v)=>toggleItem(it.k, v)} />
              {on && (
                <div style={{ padding:"0 0 8px" }}>
                  <textarea value={notes[it.k] || ""} onChange={e=>setNotes(prev => ({ ...prev, [it.k]: e.target.value }))}
                    placeholder="働き手へのひとこと（任意・例：加入している保険会社や補償の範囲など）" rows={2} maxLength={300}
                    className="field f-sans" style={{ fontSize:13, resize:"vertical", width:"100%", boxSizing:"border-box", background:"#fff" }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {items.includes("considering") && (
        <button onClick={()=>{ window.location.hash="/help/faq"; }} className="f-sans" style={{ background:"none", border:"none", padding:0, color:accent, fontSize:13, fontWeight:700, textDecoration:"underline", cursor:"pointer", marginBottom:16 }}>→ 1日保険の入り方（ヘルプ）</button>
      )}
      {/* この箱は自分で保存する（下の共通「保存する」は押さなくてよい）＝緊急連絡先と同じ */}
      <button onClick={save} disabled={saving} className="f-sans"
        style={{ width:"100%", padding:"14px", fontSize:15, fontWeight:700, background:accent, color:"#fff", border:"none", borderRadius:12, cursor:"pointer" }}>{saving ? <>保存中<Dots /></> : "保存する"}</button>
      {saved && <p className="f-sans" style={{ fontSize:12, color:accent, textAlign:"center", marginTop:12 }}>保存しました</p>}
    </>
  );
}
