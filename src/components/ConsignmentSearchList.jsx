// さがすページ「委託」タブの一覧（2026-08-03たきと指示）。
// 表示条件は lib/consignAccess.js の canSeeConsignment が決める＝このコンポーネントは呼ばれた時点で「見せてよい相手」。
// サーバー側でも consignment_deals のRLSが app_admins 限定ので、フロントの条件を外しただけでは中身は出ない（二重の壁）。
//
// カードの見た目は委託準備室の一覧と揃える（さがすのJobCardの型・カラーはブラック）。
// ★準備室（components/admin/ConsignmentRoom.jsx）のカードとは別実装：あちらは別セッションが活発に編集中ので、
//   共通部品への切り出しは所有権が1本になってから行う（CLAUDE.md・分割作業中は触る手を1本に固定）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { getCache, setCache } from "../lib/viewCache";
import { AutoSkeleton, useSkeletonProbe } from "./ui";

// 募集の状態（準備室と同じ語彙・色）
const recruitState = (status) => {
  if (status === "done") return { l:"完了", bg:"#EEEEEE", fg:"#666666" };
  if (status === "working") return { l:"作業中", bg:"#111111", fg:"#ffffff" };
  if (status === "closed") return { l:"募集終了", bg:"#EEEEEE", fg:"#666666" };
  return { l:"募集中", bg:"#111111", fg:"#ffffff" };
};
// 履行期限の短い表記（M/D〜M/D）
const dateChipLabel = (ds, de) => {
  const f = (v) => { const [, m, d] = String(v).split("-"); return m && d ? `${Number(m)}/${Number(d)}` : ""; };
  const a = ds ? f(ds) : "", b = de ? f(de) : "";
  if (a && b && a !== b) return `${a}〜${b}`;
  return a || b || "";
};

export function ConsignmentSearchList() {
  // 前回の内容があればまず出す→裏で最新に差し替える（viewCache・他ページと同じ作法）
  const [deals, setDeals] = useState(() => getCache("search:consignDeals") ?? null);
  const skelRef = useSkeletonProbe("searchConsign");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("consignment_deals").select("id,status,spec,created_at")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      // 失敗時はキャッシュ表示を消さない（空で上書きして「ゼロ件」に見せない）
      if (error) { setDeals(prev => prev ?? []); return; }
      const rows = data || [];
      setDeals(rows);
      setCache("search:consignDeals", rows);
    })();
    return () => { cancelled = true; };
  }, []);

  if (deals === null) return <div ref={skelRef}><AutoSkeleton shapeKey="searchConsign" /></div>;
  if (deals.length === 0) {
    return (
      <div style={{ textAlign:"center", padding:"64px 20px", color:"#999" }} className="f-sans">
        <div style={{ fontSize:40, marginBottom:12 }}>📄</div>
        <p style={{ fontSize:16, margin:0, lineHeight:1.6 }}>現在、募集中の委託はありません</p>
      </div>
    );
  }
  return (
    <div ref={skelRef} style={{ display:"grid", gap:22, gridTemplateColumns:"minmax(0, 1fr)" }}>
      {deals.map(d => {
        const s = d.spec || {};
        const st = recruitState(d.status);
        const photo = s.photos && s.photos[0] && s.photos[0].url;
        const chip = dateChipLabel(s.date_start, s.date_end) || s.deadline || "";
        return (
          <button key={d.id} onClick={()=>{ window.location.hash = "/admin/consignment/deal/" + d.id; }} className="f-sans"
            style={{ display:"block", width:"100%", maxWidth:"100%", minWidth:0, boxSizing:"border-box", padding:0, textAlign:"left",
                     cursor:"pointer", background:"transparent", border:"none", position:"relative", overflow:"hidden", borderRadius:16 }}>
            <span className="f-sans" style={{ position:"absolute", top:10, left:10, zIndex:2, padding:"4px 12px", borderRadius:8, fontSize:12.1, fontWeight:800, background:st.bg, color:st.fg, boxShadow:"0 1px 4px rgba(0,0,0,.18)" }}>{st.l}</span>
            {chip && (
              <span className="f-sans" style={{ position:"absolute", top:186, right:8, zIndex:2, padding:"4px 10px", borderRadius:20, background:"rgba(255,255,255,0.92)", color:"#222", fontSize:12.1, fontWeight:700, boxShadow:"0 1px 4px rgba(0,0,0,.18)" }}>{chip}</span>
            )}
            {photo ? (
              <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:220, objectFit:"cover", display:"block", borderRadius:16 }} />
            ) : (
              <div style={{ width:"100%", height:220, borderRadius:16, background:"#F7F7F7" }} />
            )}
            <div style={{ padding:"12px 4px 0" }}>
              <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:4 }}>
                <p className="f-sans" style={{ fontSize:17.6, fontWeight:600, color:"#222", margin:0, flex:"1 1 auto", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {s.field_name || "（圃場未記入）"}　{[s.crop, s.task].filter(Boolean).join(" ")}
                </p>
                <span className="f-sans" style={{ fontSize:12.1, color:"#B0B0B0", flexShrink:0, whiteSpace:"nowrap" }}>{s.region}</span>
              </div>
              <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:8 }}>
                <p className="f-mono" style={{ fontSize:16.5, fontWeight:700, color:"#111111", margin:0 }}>
                  {s.unit_price_10a ? Number(s.unit_price_10a).toLocaleString() + "円/10a" : "単価未設定"}
                </p>
                {s.area_a && <span className="f-sans" style={{ fontSize:13.2, fontWeight:700, color:"#717171", flexShrink:0 }}>{s.area_a}a</span>}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
