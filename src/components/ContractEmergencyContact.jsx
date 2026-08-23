// 採用成立後の緊急連絡先の開示（当事者間のみ・2026-08-03たきと指示）。
// ・保管は専用テーブル emergency_contacts（self-only＝本人しか直接読めない）。
//   worker_profiles／employer_profiles には置かない（応募段階で農家に見えてしまうため）。
// ・唯一の窓口は SECURITY DEFINER 関数 contract_emergency_contact(application_id)。
//   当事者のみ・terms_snapshot（＝採用成立）が無ければ中身を返さない＝氏名開示（裁定B）と同じ作法。
// ・返り値：{ok:true, empty:false, name, relation, phone}／{ok:true, empty:true, message}（相手が未登録）／
//   {ok:false, reason:'not_contracted', message}（採用前）／not_party・not_found は何も出さない。
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { NavIconInline } from "./NavIcons";

// 採用成立後の値だけキャッシュする（相手が後から登録・修正することがあるので empty はキャッシュしない）
const CACHE = new Map(); // applicationId -> {ok:true, empty:false, ...}

export default function ContractEmergencyContact({ applicationId, showPending = false, style }) {
  const [res, setRes] = useState(() => (applicationId && CACHE.get(applicationId)) || null);
  useEffect(() => {
    let live = true;
    if (!applicationId) { setRes(null); return; }
    if (CACHE.has(applicationId)) { setRes(CACHE.get(applicationId)); return; }
    (async () => {
      try {
        const { data } = await supabase.rpc("contract_emergency_contact", { p_application_id: applicationId });
        if (data && data.ok && data.empty === false) CACHE.set(applicationId, data);
        if (live) setRes(data || null);
      } catch { if (live) setRes(null); }
    })();
    return () => { live = false; };
  }, [applicationId]);

  if (!res) return null;
  if (res.ok && res.empty === false) {
    return (
      <div className="f-sans" style={{ background:"#FFF4F4", border:"1px solid #F3C9C9", borderRadius:10, padding:"8px 10px", margin:"6px 0 0", ...style }}>
        <p style={{ fontSize:11, fontWeight:700, color:"#B03A3A", margin:"0 0 2px" }}><NavIconInline name="phone" size={11} style={{ verticalAlign:"-1.5px" }} />緊急連絡先（採用が決まったため表示）</p>
        <p style={{ fontSize:13, color:"#222", margin:0, lineHeight:1.6 }}>
          {res.name}{res.relation ? `（${res.relation}）` : ""}
          {res.phone && <>　<a href={`tel:${String(res.phone).replace(/[^0-9+]/g, "")}`} style={{ color:"#B03A3A", fontWeight:700 }}>{res.phone}</a></>}
        </p>
        <p style={{ fontSize:10, color:"#B0B0B0", margin:"4px 0 0", lineHeight:1.5 }}>事故など緊急時のための連絡先です。ほかの用件では使わないでください。</p>
      </div>
    );
  }
  // 相手が未登録／採用前の案内は、置き場所によっては出さない（showPending=false が既定）
  if (showPending && res.message) {
    return <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"4px 0 0", ...style }}>{res.message}</p>;
  }
  return null;
}
