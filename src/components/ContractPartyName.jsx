// 契約成立後の氏名開示（当事者間のみ・2026-07-30 たきと裁定(B)）。
// ・account_holders（本人確認KYC）は self-only のまま。worker_profiles への本名コピーは禁止。
//   唯一の窓口は SECURITY DEFINER 関数 contract_party_name(application_id)。当事者のみ・
//   terms_snapshot（契約成立）が無ければ本名を返さない。
// ・返り値：{ok:true, name} 契約成立→相手の本名／{ok:false, reason:'not_contracted', message} 未契約→
//   message をそのまま表示／not_party・not_found・name空 は何も出さない。
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// ok（契約成立＝本名確定・以後不変）だけキャッシュする。not_contracted は契約成立で変わりうるので毎回引く。
const CACHE = new Map(); // applicationId -> {ok:true,name}

export default function ContractPartyName({ applicationId, showPending = true, style }) {
  const [res, setRes] = useState(() => (applicationId && CACHE.get(applicationId)) || null);
  useEffect(() => {
    let live = true;
    if (!applicationId) { setRes(null); return; }
    if (CACHE.has(applicationId)) { setRes(CACHE.get(applicationId)); return; }
    (async () => {
      try {
        const { data } = await supabase.rpc("contract_party_name", { p_application_id: applicationId });
        if (data && data.ok) CACHE.set(applicationId, data);
        if (live) setRes(data || null);
      } catch { if (live) setRes(null); }
    })();
    return () => { live = false; };
  }, [applicationId]);

  if (!res) return null;
  if (res.ok && res.name) {
    return (
      <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0", ...style }}>
        お名前：{res.name}<span style={{ color:"#B0B0B0", fontWeight:400 }}>（契約のため表示）</span>
      </p>
    );
  }
  if (showPending && !res.ok && res.reason === "not_contracted" && res.message) {
    return (
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"4px 0 0", ...style }}>{res.message}</p>
    );
  }
  return null;
}
