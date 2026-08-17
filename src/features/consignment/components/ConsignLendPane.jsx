// 貸与・提供できるものの登録簿（委託者単位）。第2次構造改革2026-08-17で分離・中身は不変。
import { useState } from "react";
import { supabase } from "../../../lib/supabase";
import { CONSIGN_LEND_KINDS, CONSIGN_LEND_PH, normalizeLendItems } from "../model";

// ── 貸与・提供できるもの（2026-08-02たきと指示・圃場の設備の貸与欄から移植／
//    2026-08-03 消耗品を追加＝4区分から先に選ばせる）──
// プロフィールのスワイプ3枚目。委託者単位の登録簿（正本= consignor_data.cmn_lend_items）。
// 保存形は [{k:区分, n:名前}]。旧データ（文字列の配列）は読み込み時に {k:"", n:文字列} へ正規化。
// 案件側は呼び出し（選択）＋掲載時に写し（spec.facility_lend）を凍結する
// 委託の型（定数・純関数） → features/consignment/model.js へ移設（2026-08-17）
export function ConsignLendPane({ consignor, onSaved }) {
  const items = normalizeLendItems(((consignor || {}).consignor_data || {}).cmn_lend_items);
  const [kind, setKind] = useState("");
  const [input, setInput] = useState("");
  const [lBusy, setLBusy] = useState(false);
  const persist = async (next) => {
    if (lBusy) return;
    setLBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLBusy(false); return; }
      const merged = { ...((consignor && consignor.consignor_data) || {}), cmn_lend_items: next };
      const { error } = await supabase.from("consignment_profiles").upsert({
        auth_id: session.user.id, consignor_data: merged, updated_at: new Date().toISOString(),
      }, { onConflict: "auth_id" });
      if (error) alert("保存に失敗しました：" + error.message);
      else onSaved({ ...(consignor || {}), consignor_data: merged });
    } catch { alert("保存に失敗しました。"); }
    setLBusy(false);
  };
  const add = () => {
    // 「・」は案件側の区切り文字ので名前には使わせない（スペースに置換）
    const v = input.replace(/・/g, " ").trim();
    if (!v || !kind) return;
    if (items.some(x => x.n === v)) { setInput(""); return; }
    persist([...items, { k: kind, n: v }]); setInput("");
  };
  const del = (i) => persist(items.filter((_, k) => k !== i));
  // 区分ごとに並べる（未分類＝旧データは最後に「その他」で出す）
  const groups = [...CONSIGN_LEND_KINDS.map(k => [k, items.map((it, i) => ({ ...it, i })).filter(x => x.k === k)]),
    ["その他", items.map((it, i) => ({ ...it, i })).filter(x => !CONSIGN_LEND_KINDS.includes(x.k))]]
    .filter(([, list]) => list.length);
  return (
    <div>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#111111", margin:"0 0 4px" }}>貸与・提供できるもの</h2>
      <p className="f-sans" style={{ fontSize:13.2, color:"#999999", margin:"0 0 16px" }}>道具・機械・設備・消耗品を登録します。ここで登録した内容が、委託の作成ページと仕様書に自動で反映されます。</p>
      {/* まず区分を選ぶ（2026-08-03たきと指示）→選ぶまで名前は入力できない */}
      <label className="lbl f-sans">区分を選んでください</label>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12 }}>
        {CONSIGN_LEND_KINDS.map(k => {
          const on = kind === k;
          return (
            <button key={k} type="button" onClick={()=>setKind(on ? "" : k)} className="f-sans" style={{ padding:"9px 18px", fontSize:15.4, fontWeight:700, borderRadius:10, cursor:"pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{k}</button>
          );
        })}
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:6 }}>
        <input className="field f-sans" value={input} disabled={!kind} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{ if (e.key === "Enter") add(); }} placeholder={kind ? CONSIGN_LEND_PH[kind] : "先に区分を選んでください"} style={{ fontSize:15.4, marginBottom:0, flex:1, background: kind ? "#fff" : "#F7F7F7" }} />
        <button type="button" onClick={add} disabled={lBusy || !kind || !input.trim()} className="f-sans" style={{ flexShrink:0, padding:"0 18px", fontSize:14.3, fontWeight:700, background:"#111111", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity: (lBusy || !kind || !input.trim()) ? 0.4 : 1 }}>追加</button>
      </div>
      <p className="f-sans" style={{ fontSize:12.1, color:"#999999", margin:"0 0 16px" }}>{kind ? "「" + kind + "」として登録されます。続けて追加できます。" : "区分をタップすると入力できます。"}</p>
      {items.length === 0 && (
        <p className="f-sans" style={{ fontSize:13.2, color:"#999999", margin:0 }}>登録されたものはまだありません。</p>
      )}
      {groups.map(([g, list]) => (
        <div key={g} style={{ marginBottom:14 }}>
          <p className="f-sans" style={{ fontSize:13.2, fontWeight:800, color:"#111111", margin:"0 0 6px" }}>{g}</p>
          {list.map(it => (
            <div key={it.n} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, background:"#fff", border:"1px solid #111111", borderRadius:12, padding:"12px 14px", marginBottom:8 }}>
              <span className="f-sans" style={{ fontSize:14.3, fontWeight:700, color:"#111111", overflowWrap:"break-word", wordBreak:"break-word" }}>{it.n}</span>
              <button type="button" onClick={()=>del(it.i)} disabled={lBusy} className="f-sans" style={{ flexShrink:0, width:28, height:28, borderRadius:"50%", border:"1px solid #D0D0D0", background:"#fff", color:"#999999", fontSize:14.3, fontWeight:700, lineHeight:1, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0 }}>×</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
